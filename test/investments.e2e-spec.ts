import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('Investments (e2e)', () => {
  let app: INestApplication<App>;
  const accountIds: string[] = [];
  const applicationIds: string[] = [];
  const transferIds: string[] = [];
  const prefix = `Investimento teste ${randomUUID()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.get(DatabaseService).transaction(async (client) => {
      if (transferIds.length) {
        await client.query(
          'DELETE FROM cash_book_entries WHERE transfer_id = ANY($1::uuid[])',
          [transferIds],
        );
        await client.query(
          'DELETE FROM investment_transactions WHERE transfer_id = ANY($1::uuid[])',
          [transferIds],
        );
        await client.query(
          'DELETE FROM cash_book_transfers WHERE id = ANY($1::uuid[])',
          [transferIds],
        );
      }
      if (applicationIds.length) {
        await client.query(
          'DELETE FROM investment_transactions WHERE application_id = ANY($1::uuid[])',
          [applicationIds],
        );
        await client.query(
          'DELETE FROM investment_applications WHERE id = ANY($1::uuid[])',
          [applicationIds],
        );
      }
      if (accountIds.length) {
        await client.query(
          'DELETE FROM cash_book_entries WHERE account_id = ANY($1::uuid[])',
          [accountIds],
        );
        await client.query(
          'DELETE FROM financial_accounts WHERE id = ANY($1::uuid[])',
          [accountIds],
        );
      }
    });
    accountIds.length = 0;
    applicationIds.length = 0;
    transferIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAccount(type: 'checking' | 'investment') {
    const response = await request(app.getHttpServer())
      .post('/financial-accounts')
      .send({
        name: `Test-${type}-${randomUUID()}`,
        type,
        openingBalance: '0.00',
        referenceDate: '2026-01-01',
      })
      .expect(201);
    accountIds.push(response.body.id as string);
    return response.body.id as string;
  }

  async function createApplication(
    accountId: string,
    openingBalance = '5000.00',
  ) {
    const response = await request(app.getHttpServer())
      .post('/investments')
      .send({
        name: `${prefix} CDB`,
        accountId,
        investmentType: 'CDB',
        openingBalance,
        referenceDate: '2026-01-01',
      })
      .expect(201);
    applicationIds.push(response.body.id as string);
    return response.body.id as string;
  }

  it('recalcula rendimentos e ajustes após alterações retroativas', async () => {
    const investmentAccountId = await createAccount('investment');
    const applicationId = await createApplication(investmentAccountId);
    const api = request(app.getHttpServer());

    await api
      .post(`/investments/${applicationId}/transactions`)
      .send({
        occurredAt: '2026-01-03',
        type: 'income',
        amount: '2.50',
        origin: 'Rendimento diário',
      })
      .expect(201);
    const secondIncome = await api
      .post(`/investments/${applicationId}/transactions`)
      .send({
        occurredAt: '2026-01-03',
        type: 'income',
        amount: '1.25',
        origin: 'Rendimento diário',
      })
      .expect(201);
    const adjustment = await api
      .post(`/investments/${applicationId}/transactions`)
      .send({
        occurredAt: '2026-01-04',
        type: 'adjustment',
        amount: '-100.00',
        notes: 'Correção justificada',
      })
      .expect(201);

    const beforeEdit = await api
      .get('/investments/summary?month=2026-01')
      .expect(200);
    expect(beforeEdit.body.investedBalance).toBe('4903.75');

    await api
      .patch(`/investments/transactions/${adjustment.body.id as string}`)
      .send({ amount: '-50.00' })
      .expect(200);
    await api
      .delete(`/investments/transactions/${secondIncome.body.id as string}`)
      .expect(200);

    const afterEdit = await api
      .get('/investments/summary?month=2026-01')
      .expect(200);
    expect(afterEdit.body.investedBalance).toBe('4952.50');
    expect(afterEdit.body.income).toBe('2.50');
  });

  it('vincula aportes às transferências e evita duplicar patrimônio', async () => {
    const checkingAccountId = await createAccount('checking');
    const investmentAccountId = await createAccount('investment');
    const applicationId = await createApplication(investmentAccountId);
    const api = request(app.getHttpServer());

    const transfer = await api
      .post('/transfers')
      .send({
        occurredAt: '2026-01-05',
        description: `${prefix} aporte`,
        amount: '600.00',
        sourceAccountId: checkingAccountId,
        destinationAccountId: investmentAccountId,
        destinationApplicationId: applicationId,
      })
      .expect(201);
    transferIds.push(transfer.body.id as string);

    const afterCreate = await api
      .get('/investments/summary?month=2026-01')
      .expect(200);
    expect(afterCreate.body.investedBalance).toBe('5600.00');
    expect(afterCreate.body.contributions).toBe('600.00');

    await api
      .patch(`/transfers/${transfer.body.id as string}`)
      .send({ amount: '650.00' })
      .expect(200);
    const afterUpdate = await api
      .get(`/investments/${applicationId}/transactions?month=2026-01`)
      .expect(200);
    expect(
      afterUpdate.body.filter(
        (movement: { type: string }) => movement.type === 'contribution',
      ),
    ).toHaveLength(1);
    expect(afterUpdate.body[0].balance).toBe('5650.00');

    const secondInvestmentAccountId = await createAccount('investment');
    const secondApplicationId = await createApplication(
      secondInvestmentAccountId,
      '0.00',
    );
    const internalTransfer = await api
      .post('/transfers')
      .send({
        occurredAt: '2026-01-06',
        description: `${prefix} transferência entre aplicações`,
        amount: '100.00',
        sourceAccountId: investmentAccountId,
        sourceApplicationId: applicationId,
        destinationAccountId: secondInvestmentAccountId,
        destinationApplicationId: secondApplicationId,
      })
      .expect(201);
    transferIds.push(internalTransfer.body.id as string);
    const afterInternalTransfer = await api
      .get('/investments/summary?month=2026-01')
      .expect(200);
    expect(afterInternalTransfer.body.investedBalance).toBe('5650.00');

    await api
      .delete(`/transfers/${internalTransfer.body.id as string}`)
      .expect(200);
    const afterInternalTransferDelete = await api
      .get('/investments/summary?month=2026-01')
      .expect(200);
    expect(afterInternalTransferDelete.body.investedBalance).toBe('5650.00');

    await api.delete(`/transfers/${transfer.body.id as string}`).expect(200);
    const afterDelete = await api
      .get('/investments/summary?month=2026-01')
      .expect(200);
    expect(afterDelete.body.investedBalance).toBe('5000.00');
    expect(afterDelete.body.contributions).toBe('0');
  });
});
