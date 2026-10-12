import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('Investment evolution (e2e)', () => {
  let app: INestApplication<App>;
  const accountIds: string[] = [];
  const applicationIds: string[] = [];
  const transferIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.get(DatabaseService).transaction(async (client) => {
      if (transferIds.length) {
        await client.query('DELETE FROM cash_book_entries WHERE transfer_id=ANY($1::uuid[])', [transferIds]);
        await client.query('DELETE FROM investment_transactions WHERE transfer_id=ANY($1::uuid[])', [transferIds]);
        await client.query('DELETE FROM cash_book_transfers WHERE id=ANY($1::uuid[])', [transferIds]);
      }
      if (applicationIds.length) {
        await client.query('DELETE FROM investment_transactions WHERE application_id=ANY($1::uuid[])', [applicationIds]);
        await client.query('DELETE FROM investment_applications WHERE id=ANY($1::uuid[])', [applicationIds]);
      }
      if (accountIds.length) {
        await client.query('DELETE FROM cash_book_entries WHERE account_id=ANY($1::uuid[])', [accountIds]);
        await client.query('DELETE FROM financial_accounts WHERE id=ANY($1::uuid[])', [accountIds]);
      }
    });
    accountIds.length = 0;
    applicationIds.length = 0;
    transferIds.length = 0;
  });

  afterAll(async () => app.close());

  async function createAccount(type: 'checking' | 'investment') {
    const response = await request(app.getHttpServer()).post('/financial-accounts').send({
      name: `Evolution-${randomUUID()}`, type, openingBalance: '0.00', referenceDate: '2026-01-01',
    }).expect(201);
    accountIds.push(response.body.id as string);
    return response.body.id as string;
  }

  async function createApplication(accountId: string, name: string, openingBalance: string) {
    const response = await request(app.getHttpServer()).post('/investments').send({
      name: `${name}-${randomUUID()}`, accountId, investmentType: 'CDB', openingBalance, referenceDate: '2026-01-01',
    }).expect(201);
    applicationIds.push(response.body.id as string);
    return response.body.id as string;
  }

  it('consolida posições e não duplica transferências entre aplicações', async () => {
    const firstAccount = await createAccount('investment');
    const secondAccount = await createAccount('investment');
    const cashAccount = await createAccount('checking');
    const firstApplication = await createApplication(firstAccount, 'CDB principal', '1000.00');
    const secondApplication = await createApplication(secondAccount, 'CDB secundário', '300.00');
    const api = request(app.getHttpServer());

    const internalTransfer = await api.post('/transfers').send({
      occurredAt: '2026-01-10', description: 'Realocação entre aplicações', amount: '100.00',
      sourceAccountId: firstAccount, destinationAccountId: secondAccount,
      sourceApplicationId: firstApplication, destinationApplicationId: secondApplication,
    }).expect(201);
    transferIds.push(internalTransfer.body.id as string);

    const externalTransfer = await api.post('/transfers').send({
      occurredAt: '2026-01-12', description: 'Aporte externo', amount: '200.00',
      sourceAccountId: cashAccount, destinationAccountId: firstAccount,
      destinationApplicationId: firstApplication,
    }).expect(201);
    transferIds.push(externalTransfer.body.id as string);

    await api.post(`/investments/${firstApplication}/transactions`).send({
      occurredAt: '2026-01-15', type: 'income', amount: '5.00', origin: 'Rendimento',
    }).expect(201);

    const summary = await api.get('/investment-evolution/summary?fromMonth=2026-01&toMonth=2026-01').expect(200);
    expect(summary.body.endingBalance).toBe('1505.00');
    expect(summary.body.contributions).toBe('200.00');
    expect(summary.body.income).toBe('5.00');

    const firstApplicationSummary = await api.get(`/investment-evolution/summary?fromMonth=2026-01&toMonth=2026-01&applicationId=${firstApplication}`).expect(200);
    expect(firstApplicationSummary.body.endingBalance).toBe('1105.00');
    expect(firstApplicationSummary.body.contributions).toBe('200.00');

    const history = await api.get('/investment-evolution/history?fromMonth=2026-01&toMonth=2026-02').expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body[0]).toMatchObject({ month: '2026-01', contributions: '200.00', withdrawals: '0.00', income: '5.00', endingBalance: '1505.00' });
    expect(history.body[1].endingBalance).toBe('1505.00');
  });

  it('retorna histórico vazio quando não há aplicação no filtro', async () => {
    const response = await request(app.getHttpServer())
      .get(`/investment-evolution/history?fromMonth=2026-01&toMonth=2026-03&applicationId=${randomUUID()}`)
      .expect(200);
    expect(response.body).toEqual([]);
  });
});
