import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('Financial forecasts (e2e)', () => {
  let app: INestApplication<App>;
  const seriesIds: string[] = [];
  const forecastIds: string[] = [];
  const entryIds: string[] = [];
  const accountIds: string[] = [];
  const categoryIds: string[] = [];
  const distributionPeriods: string[] = [];
  const repasseIds: string[] = [];
  const repasseDestinationIds: string[] = [];

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
    const db = app.get(DatabaseService);
    await db.transaction(async (client) => {
      if (forecastIds.length)
        await client.query(
          'DELETE FROM forecast_reconciliations WHERE forecast_id = ANY($1::uuid[])',
          [forecastIds],
        );
      if (repasseIds.length)
        await client.query('DELETE FROM financial_repasses WHERE id=ANY($1::uuid[])', [repasseIds]);
      if (repasseDestinationIds.length)
        await client.query('DELETE FROM forecast_destinations WHERE id=ANY($1::uuid[])', [repasseDestinationIds]);
      if (entryIds.length)
        await client.query(
          'DELETE FROM forecast_reconciliations WHERE cash_book_entry_id = ANY($1::uuid[])',
          [entryIds],
        );
      if (forecastIds.length)
        await client.query(
          'DELETE FROM financial_forecasts WHERE id = ANY($1::uuid[])',
          [forecastIds],
        );
      if (seriesIds.length)
        await client.query(
          'DELETE FROM financial_forecast_series WHERE id = ANY($1::uuid[])',
          [seriesIds],
        );
      if (entryIds.length)
        await client.query(
          'DELETE FROM cash_book_entries WHERE id = ANY($1::uuid[])',
          [entryIds],
        );
      if (accountIds.length)
        await client.query(
          'DELETE FROM financial_accounts WHERE id = ANY($1::uuid[])',
          [accountIds],
        );
      if (categoryIds.length)
        await client.query(
          'DELETE FROM financial_categories WHERE id = ANY($1::uuid[])',
          [categoryIds],
        );
      if (distributionPeriods.length)
        await client.query(
          'DELETE FROM forecast_distributions WHERE period = ANY($1::char(7)[])',
          [distributionPeriods],
        );
    });
    seriesIds.length = 0;
    forecastIds.length = 0;
    entryIds.length = 0;
    accountIds.length = 0;
    categoryIds.length = 0;
    distributionPeriods.length = 0;
    repasseIds.length = 0;
    repasseDestinationIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  async function fixtures() {
    const api = request(app.getHttpServer());
    const token = randomUUID();
    const account = await api
      .post('/financial-accounts')
      .send({
        name: `Previsão Teste-${token}`,
        type: 'checking',
        openingBalance: '0.00',
        referenceDate: '2026-01-01',
      })
      .expect(201);
    accountIds.push(account.body.id as string);
    const category = await api
      .post('/financial-categories')
      .send({ name: `Despesa Prevista-${token}`, nature: 'expense' })
      .expect(201);
    categoryIds.push(category.body.id as string);
    return {
      api,
      account: account.body as { id: string },
      category: category.body as { id: string },
    };
  }

  it('gera ocorrências recorrentes e recalcula a realização parcial após edição ou exclusão do Livro Caixa', async () => {
    const { api, account, category } = await fixtures();
    const created = await api
      .post('/financial-forecasts')
      .send({
        kind: 'expense',
        description: 'Aluguel previsto',
        amount: '100.00',
        dueDate: '2026-01-31',
        categoryId: category.id,
        accountId: account.id,
        recurrence: 'monthly',
        occurrenceCount: 3,
      })
      .expect(201);
    seriesIds.push(created.body.seriesId as string);
    forecastIds.push(...(created.body.occurrenceIds as string[]));

    const rows = await api
      .get('/financial-forecasts?period=2026-01')
      .expect(200);
    expect(rows.body).toHaveLength(1);
    expect(rows.body[0]).toMatchObject({
      amount: '100.00',
      pending: '100.00',
      status: 'overdue',
      occurrenceIndex: 1,
      occurrenceCount: 3,
    });
    const first = rows.body[0] as { id: string };

    const actual = await api
      .post('/cash-book')
      .send({
        type: 'expense',
        occurredAt: '2026-02-02',
        description: 'Pagamento parcial',
        amount: '30.00',
        accountId: account.id,
        categoryId: category.id,
      })
      .expect(201);
    entryIds.push(actual.body.id as string);
    const candidates = await api
      .get(`/financial-forecasts/${first.id}/matches`)
      .expect(200);
    expect(
      candidates.body.some((row: { id: string }) => row.id === actual.body.id),
    ).toBe(true);
    await api
      .post(`/financial-forecasts/${first.id}/reconcile`)
      .send({ entryId: actual.body.id })
      .expect(201);
    let details = await api.get(`/financial-forecasts/${first.id}`).expect(200);
    expect(details.body).toMatchObject({
      realized: '30.00',
      pending: '70.00',
      status: 'partial',
    });

    await api
      .patch(`/cash-book/${actual.body.id}`)
      .send({ amount: '90.00' })
      .expect(200);
    details = await api.get(`/financial-forecasts/${first.id}`).expect(200);
    expect(details.body).toMatchObject({
      realized: '90.00',
      pending: '10.00',
      status: 'partial',
    });

    await api.delete(`/cash-book/${actual.body.id}`).expect(200);
    details = await api.get(`/financial-forecasts/${first.id}`).expect(200);
    expect(details.body).toMatchObject({
      realized: '0',
      pending: '100.00',
      status: 'overdue',
    });

    const later = await api
      .get('/financial-forecasts?period=2026-03')
      .expect(200);
    expect(later.body[0]).toMatchObject({
      dueDate: '2026-03-31',
      occurrenceIndex: 3,
      occurrenceCount: 3,
    });
  });

  it('exige divisão de 100% e copia os percentuais padrão para outra competência', async () => {
    const { api } = await fixtures();
    const sourcePeriod = '2098-11';
    const targetPeriod = '2098-12';
    distributionPeriods.push(targetPeriod);
    const defaults = await api
      .get(`/financial-forecasts/distributions?period=${sourcePeriod}`)
      .expect(200);
    expect(
      defaults.body.map((row: { name: string; percentage: string }) => [
        row.name,
        Number(row.percentage),
      ]),
    ).toEqual([
      ['Casa/Lazer', 70],
      ['Investimentos', 10],
      ['Flávio', 10],
      ['Laura', 10],
      ['Outras', 0],
    ]);
    const invalid = defaults.body.map(
      (row: { id: string; percentage: string }, index: number) => ({
        destinationId: row.id,
        percentage: index === 0 ? '69.99' : row.percentage,
      }),
    );
    await api
      .put(`/financial-forecasts/distributions/${sourcePeriod}`)
      .send({ entries: invalid })
      .expect(400);
    await api
      .post('/financial-forecasts/distributions/copy')
      .send({ period: sourcePeriod, targetPeriod })
      .expect(201);
    const copied = await api
      .get(`/financial-forecasts/distributions?period=${targetPeriod}`)
      .expect(200);
    expect(
      copied.body.map((row: { name: string; percentage: string }) => [
        row.name,
        Number(row.percentage),
      ]),
    ).toEqual(
      defaults.body.map((row: { name: string; percentage: string }) => [
        row.name,
        Number(row.percentage),
      ]),
    );
  });

  it('exclui a previsão da lista em vez de mantê-la como cancelada', async () => {
    const { api, account } = await fixtures();
    const incomeCategory = await api.post('/financial-categories').send({
      name: `Receita Prevista-${randomUUID()}`,
      nature: 'income',
    }).expect(201);
    categoryIds.push(incomeCategory.body.id as string);
    const created = await api.post('/financial-forecasts').send({
      kind: 'income',
      description: 'Recebimento para excluir',
      amount: '6500.00',
      dueDate: '2026-10-12',
      categoryId: incomeCategory.body.id as string,
      accountId: account.id,
      recurrence: 'once',
      occurrenceCount: 1,
    }).expect(201);
    seriesIds.push(created.body.seriesId as string);
    forecastIds.push(...(created.body.occurrenceIds as string[]));
    const id = (created.body.occurrenceIds as string[])[0];

    await api.delete(`/financial-forecasts/${id}`).expect(200);
    const rows = await api.get('/financial-forecasts?period=2026-10').expect(200);
    expect(rows.body.some((row: { id: string }) => row.id === id)).toBe(false);
  });

  it('mantém configurações globais em vigor até uma nova vigência e preserva o mês anterior', async () => {
    const api = request(app.getHttpServer());
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const nextDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
    const nextPeriod = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const created = await api.post('/financial-repasses').send({
      name: `Repasse Teste-${randomUUID()}`,
      valueType: 'percentage',
      value: '15',
      effectiveFrom: currentPeriod,
      effectiveTo: null,
    }).expect(201);
    repasseIds.push(created.body.id as string);
    repasseDestinationIds.push(created.body.destinationId as string);

    const before = await api.get(`/financial-forecasts/distributions?period=${currentPeriod}`).expect(200);
    expect(before.body.find((row: { id: string }) => row.id === created.body.destinationId).percentage).toBe('15.00');

    const nextVersion = await api.patch(`/financial-repasses/${created.body.id as string}`).send({
      name: created.body.name as string,
      valueType: 'percentage',
      value: '20',
      effectiveFrom: nextPeriod,
      effectiveTo: null,
    }).expect(200);
    repasseIds.push(nextVersion.body.id as string);

    const afterCurrent = await api.get(`/financial-forecasts/distributions?period=${currentPeriod}`).expect(200);
    const afterNext = await api.get(`/financial-forecasts/distributions?period=${nextPeriod}`).expect(200);
    expect(afterCurrent.body.find((row: { id: string }) => row.id === created.body.destinationId).percentage).toBe('15.00');
    expect(afterNext.body.find((row: { id: string }) => row.id === created.body.destinationId).percentage).toBe('20.00');
  });
});
