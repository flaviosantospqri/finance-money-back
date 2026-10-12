import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('Cash Book (e2e)', () => {
  let app: INestApplication<App>;
  const createdEntryIds: string[] = [];
  const createdTransferIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    const database = app.get(DatabaseService);
    await database.transaction(async (client) => {
      if (createdEntryIds.length) await client.query('DELETE FROM cash_book_entries WHERE id = ANY($1::uuid[])', [createdEntryIds]);
      if (createdTransferIds.length) {
        await client.query('DELETE FROM cash_book_entries WHERE transfer_id = ANY($1::uuid[])', [createdTransferIds]);
        await client.query('DELETE FROM cash_book_transfers WHERE id = ANY($1::uuid[])', [createdTransferIds]);
      }
      if (createdAccountIds.length) await client.query('DELETE FROM financial_accounts WHERE id = ANY($1::uuid[])', [createdAccountIds]);
      if (createdCategoryIds.length) await client.query('DELETE FROM financial_categories WHERE id = ANY($1::uuid[])', [createdCategoryIds]);
    });
    createdEntryIds.length = 0;
    createdTransferIds.length = 0;
    createdAccountIds.length = 0;
    createdCategoryIds.length = 0;
  });

  afterAll(async () => {
    const database = app.get(DatabaseService);
    await database.transaction(async (client) => {
      const testAccountIds = `(SELECT id FROM financial_accounts WHERE name ~ '^(Livro Caixa Retroativo|Conta Origem Teste|Conta Destino Teste|Conta Inválida Teste)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')`;
      const testCategoryIds = `(SELECT id FROM financial_categories WHERE name ~ '^(Receita de teste|Despesa de teste)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')`;
      await client.query(`DELETE FROM cash_book_entries WHERE account_id IN ${testAccountIds} OR category_id IN ${testCategoryIds}`);
      await client.query(`DELETE FROM cash_book_transfers WHERE source_account_id IN ${testAccountIds} OR destination_account_id IN ${testAccountIds}`);
      await client.query(`DELETE FROM financial_accounts WHERE id IN ${testAccountIds}`);
      await client.query(`DELETE FROM financial_categories WHERE id IN ${testCategoryIds}`);
    });
    await app.close();
  });

  async function createAccount(name: string, openingBalance = '0.00') {
    const response = await request(app.getHttpServer()).post('/financial-accounts').send({
      name: `${name}-${randomUUID()}`,
      type: 'checking',
      openingBalance,
      referenceDate: '2026-01-01',
    }).expect(201);
    createdAccountIds.push(response.body.id as string);
    return response.body as { id: string; name: string };
  }

  async function createCategory(name: string, nature: 'income' | 'expense') {
    const response = await request(app.getHttpServer()).post('/financial-categories').send({ name: `${name}-${randomUUID()}`, nature }).expect(201);
    createdCategoryIds.push(response.body.id as string);
    return response.body as { id: string };
  }

  it('recalcula saldos retroativos e transporta o saldo para a competência seguinte', async () => {
    const account = await createAccount('Livro Caixa Retroativo', '100.00');
    const income = await createCategory('Receita de teste', 'income');
    const expense = await createCategory('Despesa de teste', 'expense');
    const base = request(app.getHttpServer());

    const laterIncome = await base.post('/cash-book').send({ type: 'income', occurredAt: '2026-01-05', description: 'Recebimento posterior', amount: '10.10', accountId: account.id, categoryId: income.id }).expect(201);
    createdEntryIds.push(laterIncome.body.id as string);
    const laterExpense = await base.post('/cash-book').send({ type: 'expense', occurredAt: '2026-01-10', description: 'Pagamento posterior', amount: '2.05', accountId: account.id, categoryId: expense.id }).expect(201);
    createdEntryIds.push(laterExpense.body.id as string);
    const retroactive = await base.post('/cash-book').send({ type: 'income', occurredAt: '2026-01-03', description: 'Recebimento retroativo', amount: '1.00', accountId: account.id, categoryId: income.id }).expect(201);
    createdEntryIds.push(retroactive.body.id as string);

    let summary = await base.get(`/cash-book/summary?accountId=${account.id}&month=2026-01`).expect(200);
    expect(summary.body).toMatchObject({ openingBalance: '100.00', incomeTotal: '11.10', expenseTotal: '2.05', closingBalance: '109.05' });

    let ledger = await base.get(`/cash-book?accountId=${account.id}&month=2026-01&page=1&pageSize=10&search=Recebimento&categoryId=${income.id}`).expect(200);
    expect(ledger.body.entries.map((entry: { balance: string }) => entry.balance)).toEqual(['101.00', '111.10']);
    ledger = await base.get(`/cash-book?accountId=${account.id}&month=2026-01&type=income`).expect(200);
    expect(ledger.body.entries).toHaveLength(2);

    await base.patch(`/cash-book/${retroactive.body.id}`).send({ amount: '2.00' }).expect(200);
    summary = await base.get(`/cash-book/summary?accountId=${account.id}&month=2026-01`).expect(200);
    expect(summary.body.closingBalance).toBe('110.05');

    await base.delete(`/cash-book/${retroactive.body.id}`).expect(200);
    summary = await base.get(`/cash-book/summary?accountId=${account.id}&month=2026-02`).expect(200);
    expect(summary.body).toMatchObject({ openingBalance: '108.05', closingBalance: '108.05' });
  });

  it('persiste os dois lados de transferências e não as soma como receita ou despesa', async () => {
    const source = await createAccount('Conta Origem Teste', '100.00');
    const destination = await createAccount('Conta Destino Teste', '50.00');
    const base = request(app.getHttpServer());

    const transfer = await base.post('/transfers').send({
      occurredAt: '2026-01-05', description: 'Transferência de teste', amount: '25.25',
      sourceAccountId: source.id, destinationAccountId: destination.id,
    }).expect(201);
    createdTransferIds.push(transfer.body.id as string);

    const [sourceSummary, destinationSummary] = await Promise.all([
      base.get(`/cash-book/summary?accountId=${source.id}&month=2026-01`),
      base.get(`/cash-book/summary?accountId=${destination.id}&month=2026-01`),
    ]);
    expect(sourceSummary.body).toMatchObject({ incomeTotal: '0', expenseTotal: '0', closingBalance: '74.75' });
    expect(destinationSummary.body).toMatchObject({ incomeTotal: '0', expenseTotal: '0', closingBalance: '75.25' });

    const [sourceLedger, destinationLedger] = await Promise.all([
      base.get(`/cash-book?accountId=${source.id}&month=2026-01`),
      base.get(`/cash-book?accountId=${destination.id}&month=2026-01`),
    ]);
    expect(sourceLedger.body.entries).toHaveLength(1);
    expect(sourceLedger.body.entries[0]).toMatchObject({ transferId: transfer.body.id, type: 'transfer_debit', amount: '25.25' });
    expect(destinationLedger.body.entries).toHaveLength(1);
    expect(destinationLedger.body.entries[0]).toMatchObject({ transferId: transfer.body.id, type: 'transfer_credit', amount: '25.25' });

    await base.patch(`/transfers/${transfer.body.id}`).send({ amount: '30.00' }).expect(200);
    const [editedSourceSummary, editedDestinationSummary] = await Promise.all([
      base.get(`/cash-book/summary?accountId=${source.id}&month=2026-01`),
      base.get(`/cash-book/summary?accountId=${destination.id}&month=2026-01`),
    ]);
    expect(editedSourceSummary.body.closingBalance).toBe('70.00');
    expect(editedDestinationSummary.body.closingBalance).toBe('80.00');

    await base.delete(`/transfers/${transfer.body.id}`).expect(200);
    const [deletedSource, deletedDestination] = await Promise.all([
      base.get(`/cash-book?accountId=${source.id}&month=2026-01`),
      base.get(`/cash-book?accountId=${destination.id}&month=2026-01`),
    ]);
    expect(deletedSource.body.entries).toHaveLength(0);
    expect(deletedDestination.body.entries).toHaveLength(0);
  });

  it('recusa transferência para a mesma conta e valores zerados', async () => {
    const account = await createAccount('Conta Inválida Teste');
    const base = request(app.getHttpServer());
    await base.post('/transfers').send({
      occurredAt: '2026-01-05', description: 'Transferência inválida', amount: '1.00',
      sourceAccountId: account.id, destinationAccountId: account.id,
    }).expect(400);
    await base.post('/transfers').send({
      occurredAt: '2026-01-05', description: 'Valor inválido', amount: '0.00',
      sourceAccountId: account.id, destinationAccountId: randomUUID(),
    }).expect(400);
  });
});
