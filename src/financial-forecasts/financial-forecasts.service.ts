import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { CreateForecastDto, UpdateForecastDto } from './dto/forecast.dto.js';

type ForecastRow = {
  id: string;
  series_id: string;
  occurrence_index: number;
  due_date: string;
  kind: string;
  description: string;
  amount: string;
  category_id: string;
  account_id: string | null;
  destination_id: string | null;
  notes: string | null;
};
const sumMoney = (...values: string[]) => {
  const cents = values.reduce((sum, value) => {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
    const amount =
      BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
    return sum + (negative ? -amount : amount);
  }, 0n);
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
};
const moneyToCents = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return (
    BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))
  );
};
const percentToHundredths = (value: string) => {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value))
    throw new BadRequestException(
      'Informe percentuais com até duas casas decimais.',
    );
  const [whole = '0', fraction = ''] = value.split('.');
  const amount =
    BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  if (amount > 10000n)
    throw new BadRequestException('Um percentual não pode ser maior que 100%.');
  return amount;
};

@Injectable()
export class FinancialForecastsService {
  constructor(private readonly db: DatabaseService) {}

  async findAll(filters: {
    period?: string;
    kind?: string;
    categoryId?: string;
    status?: string;
    search?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    const values: unknown[] = [];
    const where = ['f.deleted_at IS NULL'];
    const add = (clause: (index: number) => string, value: unknown) => {
      values.push(value);
      where.push(clause(values.length));
    };
    if (filters.period)
      add((i) => `to_char(f.due_date, 'YYYY-MM') = $${i}`, filters.period);
    if (filters.kind) add((i) => `f.kind = $${i}`, filters.kind);
    if (filters.categoryId)
      add((i) => `f.category_id = $${i}`, filters.categoryId);
    if (filters.search?.trim())
      add((i) => `f.description ILIKE $${i}`, `%${filters.search.trim()}%`);
    if (filters.fromDate)
      add((i) => `f.due_date >= $${i}::date`, filters.fromDate);
    if (filters.toDate) add((i) => `f.due_date <= $${i}::date`, filters.toDate);
    const result = await this.db.query<{
      id: string;
      kind: string;
      amount: string;
      pending: string;
      status: string;
    }>(
      `WITH reconciled AS (
        SELECT r.forecast_id, SUM(COALESCE(r.amount, e.amount)) AS realized, MAX(e.occurred_at) AS realized_at
        FROM forecast_reconciliations r JOIN cash_book_entries e ON e.id=r.cash_book_entry_id AND e.deleted_at IS NULL
        WHERE r.deleted_at IS NULL GROUP BY r.forecast_id
      ), records AS (
        SELECT f.id, f.series_id AS "seriesId", f.occurrence_index AS "occurrenceIndex", s.occurrence_count AS "occurrenceCount",
          f.kind, f.description, f.amount::text AS amount, to_char(f.due_date,'YYYY-MM-DD') AS "dueDate",
          f.category_id AS "categoryId", concat_ws(' / ', parent_category.name, c.name) AS "categoryName", category_destination.name AS "categoryDestinationName", f.account_id AS "accountId", a.name AS "accountName",
          f.destination_id AS "destinationId", d.name AS "destinationName", f.notes, COALESCE(r.realized,0)::text AS realized, to_char(r.realized_at,'YYYY-MM-DD') AS "realizedAt",
          CASE WHEN f.closed_at IS NOT NULL OR f.cancelled_at IS NOT NULL THEN '0' ELSE GREATEST(f.amount-COALESCE(r.realized,0),0)::text END AS pending,
          (COALESCE(r.realized,0)>f.amount) AS divergence, f.closed_at IS NOT NULL AS closed,
          CASE WHEN f.cancelled_at IS NOT NULL THEN 'cancelled' WHEN f.closed_at IS NOT NULL OR COALESCE(r.realized,0)>=f.amount THEN 'realized'
            WHEN COALESCE(r.realized,0)>0 THEN 'partial'
            WHEN f.due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END AS status
        FROM financial_forecasts f JOIN financial_forecast_series s ON s.id=f.series_id
        JOIN financial_categories c ON c.id=f.category_id
        LEFT JOIN financial_categories parent_category ON parent_category.id=c.parent_category_id
        LEFT JOIN forecast_destinations category_destination ON category_destination.id=c.destination_id
        LEFT JOIN financial_accounts a ON a.id=f.account_id
        LEFT JOIN forecast_destinations d ON d.id=f.destination_id LEFT JOIN reconciled r ON r.forecast_id=f.id
        WHERE ${where.join(' AND ')}
      ) SELECT * FROM records ${filters.status ? `WHERE status = $${values.push(filters.status)}` : ''} ORDER BY "dueDate", description COLLATE "C", id`,
      values,
    );
    return result.rows;
  }

  async findOne(id: string) {
    const rows = await this.findAll({});
    const forecast = rows.find((row) => row.id === id);
    if (!forecast) throw new NotFoundException('Previsão não encontrada.');
    const links = await this.db.query(
      `SELECT r.id, e.id AS "entryId", e.description, e.amount::text AS "entryAmount", r.amount::text AS "linkedAmount", to_char(e.occurred_at,'YYYY-MM-DD') AS "occurredAt" FROM forecast_reconciliations r JOIN cash_book_entries e ON e.id=r.cash_book_entry_id WHERE r.forecast_id=$1 AND r.deleted_at IS NULL AND e.deleted_at IS NULL ORDER BY e.occurred_at`,
      [id],
    );
    return { ...forecast, reconciliations: links.rows };
  }

  async create(input: CreateForecastDto) {
    if (!input.description.trim() || Number(input.amount) <= 0)
      throw new BadRequestException(
        'Informe uma descrição e um valor maior que zero.',
      );
    if (input.recurrence !== 'once' && input.occurrenceCount < 2)
      throw new BadRequestException(
        'Uma recorrência precisa ter ao menos duas ocorrências.',
      );
    const count = input.recurrence === 'once' ? 1 : input.occurrenceCount;
    return this.db.transaction(async (client) => {
      const category = await client.query<{ destination_id: string }>(
        'SELECT id, destination_id FROM financial_categories WHERE id=$1 AND nature=$2 AND active=TRUE',
        [input.categoryId, input.kind],
      );
      if (!category.rowCount)
        throw new BadRequestException(
          'A categoria não corresponde ao tipo da previsão.',
        );
      const series = await client.query<{ id: string }>(
        `INSERT INTO financial_forecast_series(kind,description,amount,start_date,category_id,account_id,recurrence,occurrence_count,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          input.kind,
          input.description.trim(),
          input.amount,
          input.dueDate,
          input.categoryId,
          input.accountId || null,
          input.recurrence,
          count,
          input.notes?.trim() || null,
        ],
      );
      const id = series.rows[0].id;
      const created: string[] = [];
      const destinationId = input.kind === 'expense'
        ? category.rows[0].destination_id
        : input.destinationId || null;
      for (let index = 0; index < count; index += 1) {
        const dueDate = this.nextDate(input.dueDate, input.recurrence, index);
        const row = await client.query<{ id: string }>(
          `INSERT INTO financial_forecasts(series_id,occurrence_index,kind,description,amount,due_date,category_id,account_id,destination_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            id,
            index + 1,
            input.kind,
            input.description.trim(),
            input.amount,
            dueDate,
            input.categoryId,
            input.accountId || null,
            destinationId,
            input.notes?.trim() || null,
          ],
        );
        created.push(row.rows[0].id);
      }
      return { seriesId: id, occurrenceIds: created };
    });
  }

  async update(
    id: string,
    input: UpdateForecastDto,
    scope: 'occurrence' | 'future',
  ) {
    const current = await this.getOccurrence(id);
    const data = {
      description: input.description?.trim() || current.description,
      amount: input.amount || current.amount,
      dueDate: input.dueDate || current.due_date,
      categoryId: input.categoryId || current.category_id,
      accountId: input.accountId || current.account_id,
      destinationId: input.destinationId || current.destination_id,
      notes:
        input.notes === undefined ? current.notes : input.notes?.trim() || null,
    };
    await this.db.transaction(async (client) => {
      const valid = await client.query<{ destination_id: string }>(
        'SELECT id, destination_id FROM financial_categories WHERE id=$1 AND nature=$2 AND active=TRUE',
        [data.categoryId, current.kind],
      );
      if (!valid.rowCount)
        throw new BadRequestException(
          'A categoria não corresponde ao tipo da previsão.',
        );
      if (current.kind === 'expense') data.destinationId = valid.rows[0].destination_id;
      const predicate =
        scope === 'future'
          ? 'series_id=$1 AND due_date >= $2 AND deleted_at IS NULL AND cancelled_at IS NULL'
          : 'id=$1 AND deleted_at IS NULL';
      const args =
        scope === 'future' ? [current.series_id, current.due_date] : [id];
      const dateExpression =
        scope === 'future'
          ? `due_date + ($${args.length + 3}::date - $${args.length + 4}::date)`
          : `$${args.length + 4}::date`;
      const changes = [
        data.description,
        data.amount,
        ...(scope === 'future'
          ? [data.dueDate, current.due_date]
          : [id, data.dueDate]),
        data.categoryId,
        data.accountId,
        data.destinationId,
        data.notes,
      ];
      await client.query(
        `UPDATE financial_forecasts SET description=$${args.length + 1},amount=$${args.length + 2},due_date=${dateExpression},category_id=$${args.length + 5},account_id=$${args.length + 6},destination_id=$${args.length + 7},notes=$${args.length + 8},updated_at=NOW() WHERE ${predicate}`,
        [...args, ...changes],
      );
    });
    return this.findOne(id);
  }

  async remove(id: string, scope: 'occurrence' | 'future') {
    const current = await this.getOccurrence(id, true);
    const sql =
      scope === 'future'
        ? 'UPDATE financial_forecasts SET deleted_at=NOW(),updated_at=NOW() WHERE series_id=$1 AND due_date >= $2 AND deleted_at IS NULL'
        : 'UPDATE financial_forecasts SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL';
    await this.db.query(
      sql,
      scope === 'future' ? [current.series_id, current.due_date] : [id],
    );
    return { deleted: true };
  }

  async duplicate(id: string) {
    const row = await this.getOccurrence(id);
    return this.create({
      kind: row.kind as 'income' | 'expense',
      description: row.description,
      amount: row.amount,
      dueDate: row.due_date,
      categoryId: row.category_id,
      accountId: row.account_id ?? undefined,
      recurrence: 'once',
      occurrenceCount: 1,
      destinationId: row.destination_id ?? undefined,
      notes: row.notes ?? undefined,
    });
  }

  async summary(period: string) {
    const forecasts = await this.findAll({ period });
    const byKind = (kind: string) =>
      forecasts.filter(
        (f: Record<string, string>) =>
          f.kind === kind && f.status !== 'cancelled',
      );
    const income = sumMoney(
      ...byKind('income').map((f: Record<string, string>) => f.amount),
    );
    const expense = sumMoney(
      ...byKind('expense').map((f: Record<string, string>) => f.amount),
    );
    const committed = sumMoney(
      ...byKind('expense').map((f: Record<string, string>) => f.pending),
    );
    const [year, month] = period.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(year, month, 0))
      .toISOString()
      .slice(0, 10);
    const actual = await this.db.query<{ balance: string }>(
      `SELECT COALESCE(SUM(CASE WHEN CURRENT_DATE<a.reference_date THEN 0::numeric ELSE a.opening_balance + COALESCE((SELECT SUM(CASE WHEN e.entry_type IN ('income','transfer_credit') THEN e.amount ELSE -e.amount END) FROM cash_book_entries e WHERE e.account_id=a.id AND e.deleted_at IS NULL AND e.occurred_at >= a.reference_date AND e.occurred_at <= CURRENT_DATE),0) END),0)::text AS balance FROM financial_accounts a WHERE a.active=TRUE`,
    );
    const future = await this.db.query<{ projected: string }>(
      `WITH reconciled AS (SELECT r.forecast_id,SUM(COALESCE(r.amount,e.amount)) realized FROM forecast_reconciliations r JOIN cash_book_entries e ON e.id=r.cash_book_entry_id AND e.deleted_at IS NULL WHERE r.deleted_at IS NULL GROUP BY r.forecast_id) SELECT (COALESCE((SELECT SUM(CASE WHEN e.entry_type IN ('income','transfer_credit') THEN e.amount ELSE -e.amount END) FROM cash_book_entries e WHERE e.deleted_at IS NULL AND e.occurred_at>CURRENT_DATE AND e.occurred_at<=$1::date),0)+COALESCE((SELECT SUM(CASE WHEN f.kind='income' THEN GREATEST(f.amount-COALESCE(r.realized,0),0) ELSE -GREATEST(f.amount-COALESCE(r.realized,0),0) END) FROM financial_forecasts f LEFT JOIN reconciled r ON r.forecast_id=f.id WHERE f.deleted_at IS NULL AND f.cancelled_at IS NULL AND f.closed_at IS NULL AND f.due_date>=CURRENT_DATE AND f.due_date<=$1::date),0))::text AS projected`,
      [monthEnd],
    );
    return {
      period,
      incomePlanned: income,
      expensePlanned: expense,
      resultProjected: sumMoney(income, `-${expense}`),
      committedPending: committed,
      realBalance: actual.rows[0].balance,
      projectedBalance: sumMoney(
        actual.rows[0].balance,
        future.rows[0].projected,
      ),
      futureNet: future.rows[0].projected,
    };
  }

  async reconcile(id: string, entryId: string, amount?: string) {
    const forecast = await this.getOccurrence(id);
    const entry = await this.db.query<{
      entry_type: string;
      amount: string;
      occurred_at: string;
      description: string;
    }>(
      "SELECT entry_type,amount::text,to_char(occurred_at,'YYYY-MM-DD') occurred_at,description FROM cash_book_entries WHERE id=$1 AND deleted_at IS NULL",
      [entryId],
    );
    if (!entry.rows[0])
      throw new NotFoundException('Movimentação não encontrada.');
    const actual = entry.rows[0];
    if (actual.entry_type !== forecast.kind)
      throw new BadRequestException(
        'A natureza da movimentação não corresponde à previsão.',
      );
    if (
      amount &&
      (moneyToCents(amount) <= 0n ||
        moneyToCents(amount) > moneyToCents(actual.amount))
    )
      throw new BadRequestException(
        'O valor conciliado deve ser positivo e não pode exceder a movimentação.',
      );
    try {
      const row = await this.db.query(
        'INSERT INTO forecast_reconciliations(forecast_id,cash_book_entry_id,amount) VALUES($1,$2,$3) RETURNING id',
        [id, entryId, amount || null],
      );
      return { ...row.rows[0], forecastId: id };
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException(
          'Essa movimentação já está vinculada a uma previsão.',
        );
      throw error;
    }
  }

  async unlink(id: string, reconciliationId: string) {
    const result = await this.db.query(
      'UPDATE forecast_reconciliations SET deleted_at=NOW() WHERE id=$1 AND forecast_id=$2 AND deleted_at IS NULL RETURNING id',
      [reconciliationId, id],
    );
    if (!result.rowCount)
      throw new NotFoundException('Conciliação não encontrada.');
    return { deleted: true };
  }

  async matches(id: string) {
    const f = await this.getOccurrence(id);
    return (
      await this.db.query(
        `SELECT e.id,e.description,e.amount::text AS amount,to_char(e.occurred_at,'YYYY-MM-DD') AS "occurredAt",e.entry_type AS type,a.name AS "accountName",ABS(e.amount-$1::numeric) AS "difference",ABS(e.occurred_at-$2::date) AS "daysDifference" FROM cash_book_entries e JOIN financial_accounts a ON a.id=e.account_id WHERE e.deleted_at IS NULL AND e.entry_type=$3 AND NOT EXISTS(SELECT 1 FROM forecast_reconciliations r WHERE r.cash_book_entry_id=e.id AND r.deleted_at IS NULL) ORDER BY ABS(e.amount-$1::numeric),ABS(e.occurred_at-$2::date) LIMIT 30`,
        [f.amount, f.due_date, f.kind],
      )
    ).rows;
  }

  async close(id: string, reason: string) {
    if (!reason.trim())
      throw new BadRequestException('Informe o motivo do encerramento.');
    await this.getOccurrence(id);
    await this.db.query(
      'UPDATE financial_forecasts SET closed_at=NOW(),closure_reason=$2,updated_at=NOW() WHERE id=$1',
      [id, reason.trim()],
    );
    return this.findOne(id);
  }

  async getDestinations() {
    return (
      await this.db.query(
        'SELECT id,name,active FROM forecast_destinations WHERE active=TRUE ORDER BY name',
      )
    ).rows;
  }

  async createDestination(name: string) {
    if (!name.trim())
      throw new BadRequestException('Informe o nome da destinação.');
    try {
      const result = await this.db.query(
        'INSERT INTO forecast_destinations(name) VALUES($1) RETURNING id,name,active',
        [name.trim()],
      );
      return result.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('Já existe uma destinação com esse nome.');
      throw error;
    }
  }

  async getDistributions(period: string) {
    const result = await this.db.query<{
      id: string;
      name: string;
      valueType: 'percentage' | 'fixed';
      value: string;
      percentage: string;
      budget: string;
      consumed: string;
    }>(
      `WITH income_total AS (
         SELECT COALESCE(SUM(amount),0) amount FROM financial_forecasts
         WHERE kind='income' AND deleted_at IS NULL AND cancelled_at IS NULL AND to_char(due_date,'YYYY-MM')=$1
       ), global_repasses AS (
         SELECT DISTINCT ON(destination_id) destination_id,value_type,value
         FROM financial_repasses WHERE deleted_at IS NULL AND effective_from<=$1 AND (effective_to IS NULL OR effective_to>=$1)
         ORDER BY destination_id,effective_from DESC
       ), configured AS (
         SELECT destination_id,BOOL_OR(effective_from<=$1) AS has_started FROM financial_repasses GROUP BY destination_id
       ), targets AS (
         SELECT d.id,d.name,COALESCE(fd.value_type,gr.value_type,'percentage') AS value_type,
           COALESCE(fd.value,gr.value,CASE WHEN COALESCE(c.has_started,FALSE) THEN 0::numeric ELSE
             CASE d.name WHEN 'Casa/Lazer' THEN 70 WHEN 'Investimentos' THEN 10 WHEN 'Flávio' THEN 10 WHEN 'Laura' THEN 10 ELSE 0 END END) AS allocation_value
         FROM forecast_destinations d
         LEFT JOIN forecast_distributions fd ON fd.destination_id=d.id AND fd.period=$1
         LEFT JOIN global_repasses gr ON gr.destination_id=d.id
         LEFT JOIN configured c ON c.destination_id=d.id
         WHERE d.active=TRUE
       )
       SELECT d.id,d.name,d.value_type AS "valueType",d.allocation_value::text AS value,
         CASE WHEN d.value_type='percentage' THEN d.allocation_value ELSE 0 END::text AS percentage,
         CASE WHEN d.value_type='percentage' THEN d.allocation_value*income_total.amount/100 ELSE d.allocation_value END::numeric(14,2)::text AS budget,
         COALESCE((SELECT SUM(e.amount) FROM cash_book_entries e
           JOIN financial_categories c ON c.id=e.category_id
           WHERE c.destination_id=d.id AND e.entry_type='expense' AND e.deleted_at IS NULL
             AND to_char(e.occurred_at,'YYYY-MM')=$1),0)::numeric(14,2)::text AS consumed
       FROM targets d CROSS JOIN income_total
       ORDER BY CASE d.name WHEN 'Casa/Lazer' THEN 1 WHEN 'Investimentos' THEN 2 WHEN 'Flávio' THEN 3 WHEN 'Laura' THEN 4 WHEN 'Outras' THEN 5 ELSE 6 END,d.name`,
      [period],
    );
    return result.rows;
  }

  async saveDistributions(
    period: string,
    entries: { destinationId: string; percentage?: string; valueType?: 'percentage' | 'fixed'; value?: string }[],
  ) {
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
      !Array.isArray(entries) ||
      entries.length === 0
    )
      throw new BadRequestException(
        'Informe uma competência e ao menos uma destinação.',
      );
    const total = entries.reduce((sum, row) => sum + (row.valueType === 'fixed' ? 0n : percentToHundredths(row.value ?? row.percentage ?? '0')), 0n);
    const allPercent = entries.every((row) => row.valueType !== 'fixed');
    if ((allPercent ? total !== 10000n : total > 10000n) || new Set(entries.map((row) => row.destinationId)).size !== entries.length)
      throw new BadRequestException(
        'Os percentuais precisam totalizar 100% (ou no máximo 100% quando houver valores fixos), sem repetir destinações.',
      );
    for (const row of entries) {
      const value = row.value ?? row.percentage ?? '0';
      if (row.valueType === 'fixed' && (!/^\d{1,12}(\.\d{1,2})?$/.test(value) || moneyToCents(value) < 0n))
        throw new BadRequestException('Informe valores de repasse válidos.');
      if (row.valueType !== 'fixed') percentToHundredths(value);
    }
    return this.db.transaction(async (client) => {
      await client.query('DELETE FROM forecast_distributions WHERE period=$1', [
        period,
      ]);
      for (const row of entries) {
        const valueType = row.valueType ?? 'percentage';
        const value = row.value ?? row.percentage ?? '0';
        const percentage = valueType === 'percentage' ? value : '0';
        await client.query(
          'INSERT INTO forecast_distributions(period,destination_id,percentage,value_type,value) VALUES($1,$2,$3,$4,$5)',
          [period, row.destinationId, percentage, valueType, value],
        );
      }
      return this.getDistributions(period);
    });
  }

  async copyDistributions(period: string, targetPeriod: string) {
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetPeriod)
    )
      throw new BadRequestException('Informe competências válidas.');
    const source = await this.getDistributions(period);
    const copiedPercentage = source.reduce(
        (total: bigint, row: { valueType: string; value: string }) =>
          total + (row.valueType === 'fixed' ? 0n : percentToHundredths(row.value)),
        0n,
      );
    const copiedAllPercent = source.every((row) => row.valueType !== 'fixed');
    if (copiedPercentage > 10000n || (copiedAllPercent && copiedPercentage !== 10000n))
      throw new BadRequestException(
        'Salve uma distribuição que totalize 100% antes de copiar.',
      );
    await this.db.transaction(async (client) => {
      await client.query('DELETE FROM forecast_distributions WHERE period=$1', [
        targetPeriod,
      ]);
      for (const row of source as { id: string; percentage: string; valueType: 'percentage' | 'fixed'; value: string }[])
        await client.query(
          'INSERT INTO forecast_distributions(period,destination_id,percentage,value_type,value) VALUES($1,$2,$3,$4,$5)',
          [targetPeriod, row.id, row.valueType === 'percentage' ? row.value : '0', row.valueType, row.value],
        );
    });
    return this.getDistributions(targetPeriod);
  }

  private async getOccurrence(id: string, includeCancelled = false) {
    const result = await this.db.query<ForecastRow>(
      `SELECT id,series_id,occurrence_index,due_date::text,kind,description,amount::text,category_id,account_id,destination_id,notes FROM financial_forecasts WHERE id=$1 AND deleted_at IS NULL AND ($2::boolean OR cancelled_at IS NULL)`,
      [id, includeCancelled],
    );
    if (!result.rows[0])
      throw new NotFoundException('Previsão não encontrada.');
    return result.rows[0];
  }

  private nextDate(start: string, recurrence: string, index: number) {
    const date = new Date(`${start}T12:00:00Z`);
    if (recurrence === 'weekly') date.setUTCDate(date.getUTCDate() + 7 * index);
    if (recurrence === 'monthly') {
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + index);
      date.setUTCDate(
        Math.min(
          day,
          new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
          ).getUTCDate(),
        ),
      );
    }
    if (recurrence === 'yearly') {
      const month = date.getUTCMonth(),
        day = date.getUTCDate();
      date.setUTCFullYear(date.getUTCFullYear() + index);
      if (date.getUTCMonth() !== month) date.setUTCDate(0);
      else if (date.getUTCDate() !== day)
        date.setUTCDate(
          new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate(),
        );
    }
    return date.toISOString().slice(0, 10);
  }
}
