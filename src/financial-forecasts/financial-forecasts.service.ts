import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
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
  group_id: string | null;
  amount_type: 'fixed' | 'income_percentage';
  percentage: string | null;
};
type DistributionRow = {
  id: string;
  name: string;
  valueType: 'percentage' | 'fixed';
  value: string;
  percentage: string;
  budget: string;
  consumed: string;
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
export function rebalanceDistributionRows(
  rows: DistributionRow[],
  destinationId: string,
  percentage: string,
) {
  const target = rows.find((row) => row.id === destinationId);
  if (!target)
    throw new BadRequestException('A destinação desta previsão não possui regra de distribuição na competência.');
  if (target.valueType !== 'percentage')
    throw new BadRequestException(`A destinação ${target.name} usa valor fixo. Altere para percentual na distribuição antes de sincronizar.`);

  const targetValue = percentToHundredths(percentage);
  const currentValue = percentToHundredths(target.value);
  const peers = rows
    .filter((row) => row.id !== destinationId && row.valueType === 'percentage')
    .sort((left, right) => {
      const difference = percentToHundredths(right.value) - percentToHundredths(left.value);
      return difference > 0n ? 1 : difference < 0n ? -1 : left.name.localeCompare(right.name, 'pt-BR');
    });
  if (!peers.length && targetValue !== currentValue)
    throw new BadRequestException('É necessário haver outra destinação percentual para rebalancear a distribuição.');

  const updated = new Map(rows.map((row) => [row.id, row.value]));
  updated.set(destinationId, percentage);
  const delta = targetValue - currentValue;
  if (delta !== 0n && peers.length) {
    const largest = peers[0];
    const newValue = percentToHundredths(largest.value) - delta;
    if (newValue < 0n)
      throw new BadRequestException(`A maior fatia (${largest.name}) não tem percentual suficiente para este ajuste.`);
    updated.set(largest.id, `${newValue / 100n}.${(newValue % 100n).toString().padStart(2, '0')}`);
  } else if (delta !== 0n) {
    throw new BadRequestException('É necessário haver outra destinação percentual para rebalancear a distribuição.');
  }

  return rows.map((row) => ({
    destinationId: row.id,
    valueType: row.valueType,
    value: updated.get(row.id) ?? row.value,
  }));
}

@Injectable()
export class FinancialForecastsService {
  constructor(private readonly db: DatabaseService) {}

  async getGroups() {
    const result = await this.db.query(
      'SELECT id, name FROM forecast_groups ORDER BY name COLLATE "C", id',
    );
    return result.rows;
  }

  async createGroup(name: string) {
    const normalized = name.trim();
    if (!normalized) throw new BadRequestException('Informe o nome da aba.');
    try {
      const result = await this.db.query(
        'INSERT INTO forecast_groups(name) VALUES($1) RETURNING id, name',
        [normalized],
      );
      return result.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('Já existe uma aba com esse nome.');
      throw error;
    }
  }

  async updateGroup(id: string, name: string) {
    const normalized = name.trim();
    if (!normalized) throw new BadRequestException('Informe o nome da aba.');
    try {
      const result = await this.db.query(
        'UPDATE forecast_groups SET name=$2, updated_at=NOW() WHERE id=$1 RETURNING id, name',
        [id, normalized],
      );
      if (!result.rowCount) throw new NotFoundException('Aba não encontrada.');
      return result.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('Já existe uma aba com esse nome.');
      throw error;
    }
  }

  async deleteGroup(id: string) {
    const result = await this.db.query(
      'DELETE FROM forecast_groups WHERE id=$1 RETURNING id',
      [id],
    );
    if (!result.rowCount) throw new NotFoundException('Aba não encontrada.');
    return { deleted: true };
  }

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
      ), monthly_income AS (
        SELECT date_trunc('month', due_date)::date AS month, SUM(amount) AS amount
        FROM financial_forecasts
        WHERE kind='income' AND deleted_at IS NULL AND cancelled_at IS NULL
        GROUP BY date_trunc('month', due_date)::date
      ), records AS (
        SELECT f.id, f.series_id AS "seriesId", f.occurrence_index AS "occurrenceIndex", s.occurrence_count AS "occurrenceCount",
          f.kind, f.description,
          CASE WHEN f.amount_type='income_percentage' THEN ROUND(COALESCE(mi.amount,0)*f.percentage/100,2) ELSE f.amount END AS calculated_amount,
          f.amount_type AS "amountType", f.percentage::text AS percentage,
          to_char(f.due_date,'YYYY-MM-DD') AS "dueDate",
          f.category_id AS "categoryId", concat_ws(' / ', parent_category.name, c.name) AS "categoryName", category_destination.name AS "categoryDestinationName", f.account_id AS "accountId", a.name AS "accountName",
          f.destination_id AS "destinationId", d.name AS "destinationName", f.group_id AS "groupId", fg.name AS "groupName", f.notes,
          CASE WHEN f.retained_at IS NOT NULL THEN COALESCE(f.retained_amount,0) ELSE COALESCE(r.realized,0) END::text AS realized,
          CASE WHEN f.retained_at IS NOT NULL THEN to_char(f.retained_at,'YYYY-MM-DD') ELSE to_char(r.realized_at,'YYYY-MM-DD') END AS "realizedAt",
          CASE WHEN f.closed_at IS NOT NULL OR f.cancelled_at IS NOT NULL OR f.retained_at IS NOT NULL THEN '0' ELSE GREATEST((CASE WHEN f.amount_type='income_percentage' THEN ROUND(COALESCE(mi.amount,0)*f.percentage/100,2) ELSE f.amount END)-COALESCE(r.realized,0),0)::text END AS pending,
          (f.retained_at IS NULL AND COALESCE(r.realized,0)>(CASE WHEN f.amount_type='income_percentage' THEN ROUND(COALESCE(mi.amount,0)*f.percentage/100,2) ELSE f.amount END)) AS divergence, f.closed_at IS NOT NULL AS closed, f.retained_at IS NOT NULL AS retained, r.forecast_id IS NOT NULL AS "hasReconciliation",
          CASE WHEN f.cancelled_at IS NOT NULL THEN 'cancelled' WHEN f.closed_at IS NOT NULL OR f.retained_at IS NOT NULL OR (f.amount_type='income_percentage' AND ROUND(COALESCE(mi.amount,0)*f.percentage/100,2)=0) OR ((CASE WHEN f.amount_type='income_percentage' THEN ROUND(COALESCE(mi.amount,0)*f.percentage/100,2) ELSE f.amount END)>0 AND COALESCE(r.realized,0)>=(CASE WHEN f.amount_type='income_percentage' THEN ROUND(COALESCE(mi.amount,0)*f.percentage/100,2) ELSE f.amount END)) THEN 'realized'
            WHEN COALESCE(r.realized,0)>0 THEN 'partial'
            WHEN f.due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END AS status
        FROM financial_forecasts f JOIN financial_forecast_series s ON s.id=f.series_id
        LEFT JOIN monthly_income mi ON mi.month=date_trunc('month',f.due_date)::date
        JOIN financial_categories c ON c.id=f.category_id
        LEFT JOIN financial_categories parent_category ON parent_category.id=c.parent_category_id
        LEFT JOIN forecast_destinations category_destination ON category_destination.id=c.destination_id
        LEFT JOIN financial_accounts a ON a.id=f.account_id
        LEFT JOIN forecast_destinations d ON d.id=f.destination_id LEFT JOIN forecast_groups fg ON fg.id=f.group_id LEFT JOIN reconciled r ON r.forecast_id=f.id
        WHERE ${where.join(' AND ')}
      ) SELECT records.*, calculated_amount::text AS amount FROM records ${filters.status ? `WHERE status = $${values.push(filters.status)}` : ''} ORDER BY "dueDate", description COLLATE "C", id`,
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
    const amountType = input.amountType || 'fixed';
    const percentage = input.percentage || null;
    if (!input.description.trim() || (amountType === 'fixed' && Number(input.amount) <= 0))
      throw new BadRequestException(
        'Informe uma descrição e um valor maior que zero.',
      );
    if (amountType === 'income_percentage' && (input.kind !== 'expense' || percentage === null || Number(percentage) < 0 || Number(percentage) > 100))
      throw new BadRequestException('Informe uma despesa e um percentual válido sobre os recebimentos.');
    const storedAmount = amountType === 'income_percentage' ? '0.01' : input.amount;
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
        `INSERT INTO financial_forecast_series(kind,description,amount,start_date,category_id,account_id,recurrence,occurrence_count,notes,amount_type,percentage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          input.kind,
          input.description.trim(),
          storedAmount,
          input.dueDate,
          input.categoryId,
          input.accountId || null,
          input.recurrence,
          count,
          input.notes?.trim() || null,
          amountType,
          percentage,
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
          `INSERT INTO financial_forecasts(series_id,occurrence_index,kind,description,amount,due_date,category_id,account_id,destination_id,notes,group_id,amount_type,percentage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [
            id,
            index + 1,
            input.kind,
            input.description.trim(),
            storedAmount,
            dueDate,
            input.categoryId,
            input.accountId || null,
            destinationId,
            input.notes?.trim() || null,
            input.kind === 'expense' ? input.groupId || null : null,
            amountType,
            percentage,
          ],
        );
        created.push(row.rows[0].id);
      }
      if (amountType === 'income_percentage' && destinationId) {
        await this.syncDistributionForRepasse(
          client,
          input.dueDate.slice(0, 7),
          destinationId,
          percentage!,
        );
      }
      return { seriesId: id, occurrenceIds: created };
    });
  }

  async copyMonth(period: string, targetPeriod: string) {
    if (this.previousPeriod(targetPeriod) !== period)
      throw new BadRequestException('Só é possível copiar previsões do mês imediatamente anterior.');

    return this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`financial-forecast-copy:${targetPeriod}`]);
      const source = await client.query<ForecastRow>(
        `SELECT f.id, f.series_id, f.occurrence_index, f.due_date::text, f.kind, f.description, f.amount::text,
          f.category_id, f.account_id, f.destination_id, f.notes, f.group_id, f.amount_type, f.percentage::text
         FROM financial_forecasts f
         WHERE to_char(f.due_date, 'YYYY-MM')=$1 AND f.deleted_at IS NULL AND f.cancelled_at IS NULL
         ORDER BY f.due_date, f.id`,
        [period],
      );
      let copied = 0;
      let skipped = 0;
      const [year, month] = targetPeriod.split('-').map(Number);

      for (const row of source.rows) {
        const day = Number(row.due_date.slice(8, 10));
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const dueDate = `${targetPeriod}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
        const exists = await client.query(
          `SELECT 1 FROM financial_forecasts
           WHERE due_date=$1::date AND deleted_at IS NULL AND cancelled_at IS NULL
             AND (series_id=$12 OR (kind=$2 AND description=$3 AND amount=$4::numeric AND category_id=$5
             AND account_id IS NOT DISTINCT FROM $6::uuid
             AND destination_id IS NOT DISTINCT FROM $7::uuid
             AND notes IS NOT DISTINCT FROM $8::text
             AND group_id IS NOT DISTINCT FROM $9::uuid
             AND amount_type=$10 AND percentage IS NOT DISTINCT FROM $11::numeric))
           LIMIT 1`,
          [dueDate, row.kind, row.description, row.amount, row.category_id, row.account_id,
            row.destination_id, row.notes, row.group_id, row.amount_type, row.percentage, row.series_id],
        );
        if (exists.rowCount) {
          skipped += 1;
          continue;
        }

        const series = await client.query<{ id: string }>(
          `INSERT INTO financial_forecast_series(kind, description, amount, start_date, category_id, account_id, recurrence, occurrence_count, notes)
           VALUES($1,$2,$3,$4,$5,$6,'once',1,$7) RETURNING id`,
          [row.kind, row.description, row.amount, dueDate, row.category_id, row.account_id, row.notes],
        );
        await client.query(
          `INSERT INTO financial_forecasts(series_id, occurrence_index, kind, description, amount, due_date, category_id, account_id, destination_id, notes, group_id, amount_type, percentage)
           VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [series.rows[0].id, row.kind, row.description, row.amount, dueDate, row.category_id,
            row.account_id, row.destination_id, row.notes, row.group_id, row.amount_type, row.percentage],
        );
        copied += 1;
      }
      return { copied, skipped, sourceCount: source.rowCount ?? 0 };
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
      amountType: input.amountType || current.amount_type,
      percentage: input.percentage === undefined ? current.percentage : input.percentage,
      dueDate: input.dueDate || current.due_date,
      categoryId: input.categoryId || current.category_id,
      accountId: input.accountId || current.account_id,
      destinationId: input.destinationId || current.destination_id,
      notes:
        input.notes === undefined ? current.notes : input.notes?.trim() || null,
      groupId: input.groupId === undefined ? current.group_id : input.groupId || null,
    };
    if (data.amountType === 'income_percentage' && (current.kind !== 'expense' || data.percentage === null || Number(data.percentage) < 0 || Number(data.percentage) > 100))
      throw new BadRequestException('Informe um percentual válido entre 0 e 100%.');
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
          : `$${args.length + 3}::date`;
      const changes = [
        data.description,
        data.amountType === 'income_percentage' ? '0.01' : data.amount,
        ...(scope === 'future'
          ? [data.dueDate, current.due_date]
          : [data.dueDate]),
        data.categoryId,
        data.accountId,
        data.destinationId,
        data.notes,
        current.kind === 'expense' ? data.groupId : null,
      ];
      const categoryParameter =
        args.length + (scope === 'future' ? 5 : 4);
      const percentageParameter = categoryParameter + 6;
      const preserveOtherMonths = scope === 'future' && current.amount_type === 'income_percentage' && data.amountType === 'income_percentage';
      const preserveOtherMonthsParameter = args.length + changes.length + 3;
      const selectedDateParameter = args.length + 3;
      if (data.amountType === 'income_percentage' && data.destinationId) {
        await this.syncDistributionForRepasse(
          client,
          data.dueDate.slice(0, 7),
          data.destinationId,
          data.percentage!,
        );
      }
      await client.query(
        `UPDATE financial_forecasts SET description=$${args.length + 1},amount=$${args.length + 2},due_date=${dateExpression},category_id=$${categoryParameter},account_id=$${categoryParameter + 1},destination_id=$${categoryParameter + 2},notes=$${categoryParameter + 3},group_id=$${categoryParameter + 4},amount_type=$${categoryParameter + 5},percentage=CASE WHEN $${preserveOtherMonthsParameter}::boolean AND date_trunc('month',due_date)<>date_trunc('month',$${selectedDateParameter}::date) THEN percentage ELSE $${percentageParameter} END,retained_at=NULL,retained_amount=NULL,updated_at=NOW() WHERE ${predicate}`,
        [...args, ...changes, data.amountType, data.percentage, preserveOtherMonths],
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
      amount: row.amount_type === 'income_percentage' ? '0.01' : row.amount,
      amountType: row.amount_type,
      percentage: row.percentage ?? undefined,
      dueDate: row.due_date,
      categoryId: row.category_id,
      accountId: row.account_id ?? undefined,
      recurrence: 'once',
      occurrenceCount: 1,
      destinationId: row.destination_id ?? undefined,
      notes: row.notes ?? undefined,
      groupId: row.group_id ?? undefined,
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
    const expense = sumMoney(...byKind('expense').filter((f: Record<string, string>) => (f as Record<string, unknown>).retained !== true).map((f: Record<string, string>) => f.amount));
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
    const projection = await this.db.query<{
      projection_open: boolean;
      cash_movements: string;
      pending_income: string;
      pending_expenses: string;
    }>(
      `WITH reconciled AS (
        SELECT r.forecast_id,SUM(COALESCE(r.amount,e.amount)) AS realized
        FROM forecast_reconciliations r
        JOIN cash_book_entries e ON e.id=r.cash_book_entry_id AND e.deleted_at IS NULL
        WHERE r.deleted_at IS NULL GROUP BY r.forecast_id
       ), monthly_income AS (
        SELECT date_trunc('month',due_date)::date AS month,SUM(amount) AS amount
        FROM financial_forecasts
        WHERE kind='income' AND deleted_at IS NULL AND cancelled_at IS NULL
        GROUP BY date_trunc('month',due_date)::date
       )
       SELECT CURRENT_DATE <= $1::date AS projection_open,
        COALESCE(SUM(CASE WHEN e.entry_type IN ('income','transfer_credit') THEN e.amount ELSE -e.amount END)
          FILTER (WHERE e.occurred_at>CURRENT_DATE AND e.occurred_at<=$1::date),0)::text AS cash_movements,
        COALESCE((SELECT SUM(GREATEST((CASE WHEN f.amount_type='income_percentage' THEN ROUND(COALESCE(mi.amount,0)*f.percentage/100,2) ELSE f.amount END)-COALESCE(r.realized,0),0))
          FROM financial_forecasts f LEFT JOIN reconciled r ON r.forecast_id=f.id
          LEFT JOIN monthly_income mi ON mi.month=date_trunc('month',f.due_date)::date
          WHERE f.deleted_at IS NULL AND f.cancelled_at IS NULL AND f.closed_at IS NULL AND f.retained_at IS NULL
            AND f.kind='income' AND f.due_date<=$1::date),0)::text AS pending_income,
        COALESCE((SELECT SUM(GREATEST((CASE WHEN f.amount_type='income_percentage' THEN ROUND(COALESCE(mi.amount,0)*f.percentage/100,2) ELSE f.amount END)-COALESCE(r.realized,0),0))
          FROM financial_forecasts f LEFT JOIN reconciled r ON r.forecast_id=f.id
          LEFT JOIN monthly_income mi ON mi.month=date_trunc('month',f.due_date)::date
          WHERE f.deleted_at IS NULL AND f.cancelled_at IS NULL AND f.closed_at IS NULL AND f.retained_at IS NULL
            AND f.kind='expense' AND f.due_date<=$1::date),0)::text AS pending_expenses
       FROM cash_book_entries e WHERE e.deleted_at IS NULL`,
      [monthEnd],
    );
    const projectionOpen = projection.rows[0].projection_open;
    const pendingIncome = projectionOpen ? projection.rows[0].pending_income : '0.00';
    const pendingExpenses = projectionOpen ? projection.rows[0].pending_expenses : '0.00';
    const futureCashMovements = projectionOpen
      ? projection.rows[0].cash_movements
      : '0.00';
    const futureNet = sumMoney(
      futureCashMovements,
      pendingIncome,
      `-${pendingExpenses}`,
    );
    return {
      period,
      incomePlanned: income,
      expensePlanned: expense,
      resultProjected: sumMoney(income, `-${expense}`),
      committedPending: committed,
      realBalance: actual.rows[0].balance,
      projectedBalance: sumMoney(actual.rows[0].balance, futureNet),
      futureCashMovements,
      pendingIncome,
      pendingExpenses,
      futureNet,
      projectionOpen,
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

  async reconcileMany(id: string, entryIds: string[]) {
    if (entryIds.length === 0 || new Set(entryIds).size !== entryIds.length)
      throw new BadRequestException('Selecione movimentações diferentes.');
    const forecast = await this.getOccurrence(id);
    try {
      const links = await this.db.transaction(async (client) => {
        const entries = await client.query<{ id: string; entry_type: string }>(
          'SELECT id,entry_type FROM cash_book_entries WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL FOR UPDATE',
          [entryIds],
        );
        if (entries.rows.length !== entryIds.length)
          throw new NotFoundException('Uma ou mais movimentações não foram encontradas.');
        if (entries.rows.some((entry) => entry.entry_type !== forecast.kind))
          throw new BadRequestException(
            'A natureza de uma ou mais movimentações não corresponde à previsão.',
          );
        const inserted = [];
        for (const entryId of entryIds) {
          const row = await client.query<{ id: string }>(
            'INSERT INTO forecast_reconciliations(forecast_id,cash_book_entry_id) VALUES($1,$2) RETURNING id',
            [id, entryId],
          );
          inserted.push({ ...row.rows[0], entryId });
        }
        return inserted;
      });
      return { forecastId: id, reconciliations: links };
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException(
          'Uma ou mais movimentações já estão vinculadas a uma previsão.',
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
        `WITH target AS (
           SELECT f.id,f.description,f.category_id,f.kind,f.due_date,
             CASE WHEN f.amount_type='income_percentage' THEN ROUND(COALESCE((SELECT SUM(i.amount) FROM financial_forecasts i WHERE i.kind='income' AND i.deleted_at IS NULL AND i.cancelled_at IS NULL AND date_trunc('month',i.due_date)=date_trunc('month',f.due_date)),0)*f.percentage/100,2) ELSE f.amount END AS target_amount
           FROM financial_forecasts f WHERE f.id=$1
         ), candidates AS (
         SELECT e.id,e.description,e.amount::text AS amount,to_char(e.occurred_at,'YYYY-MM-DD') AS "occurredAt",e.entry_type AS type,a.name AS "accountName",c.name AS "categoryName",fc.name AS "forecastCategoryName",(e.category_id=t.category_id) AS category_match,(
           SELECT COUNT(*)::int FROM (
             SELECT token FROM regexp_split_to_table(regexp_replace(lower(t.description),'[^[:alnum:]]+',' ','g'),'\\s+') AS forecast_tokens(token)
             INTERSECT
             SELECT token FROM regexp_split_to_table(regexp_replace(lower(e.description),'[^[:alnum:]]+',' ','g'),'\\s+') AS entry_tokens(token)
           ) shared_tokens WHERE length(token)>2
         ) AS name_match,ABS(e.amount-t.target_amount) AS amount_difference,ABS(e.occurred_at-t.due_date)::int AS days_difference
         FROM target t
         JOIN financial_categories fc ON fc.id=t.category_id
         JOIN cash_book_entries e ON e.entry_type=$2 AND e.deleted_at IS NULL
         LEFT JOIN financial_categories c ON c.id=e.category_id
         JOIN financial_accounts a ON a.id=e.account_id
         WHERE NOT EXISTS(SELECT 1 FROM forecast_reconciliations r WHERE r.cash_book_entry_id=e.id AND r.deleted_at IS NULL)
         )
         SELECT id,description,amount,"occurredAt",type,"accountName","categoryName","forecastCategoryName",category_match AS "categoryMatch",name_match AS "nameMatch",amount_difference::text AS difference,days_difference AS "daysDifference"
         FROM candidates
         ORDER BY CASE WHEN category_match AND name_match>0 THEN 2 WHEN name_match>0 THEN 1 WHEN category_match THEN 0 ELSE -1 END DESC,amount_difference,name_match DESC,days_difference
         LIMIT 100`,
        [id, f.kind],
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

  async retain(id: string) {
    return this.db.transaction(async (client) => {
      const forecast = await client.query<{
        id: string;
        kind: string;
        retained_at: Date | null;
        calculated_amount: string;
      }>(
        `SELECT f.id,f.kind,f.retained_at,
          (CASE WHEN f.amount_type='income_percentage' THEN ROUND(COALESCE((
            SELECT SUM(i.amount) FROM financial_forecasts i
            WHERE i.kind='income' AND i.deleted_at IS NULL AND i.cancelled_at IS NULL
              AND date_trunc('month',i.due_date)=date_trunc('month',f.due_date)
          ),0)*f.percentage/100,2) ELSE f.amount END)::text AS calculated_amount
         FROM financial_forecasts f
         WHERE f.id=$1 AND f.deleted_at IS NULL
         FOR UPDATE OF f`,
        [id],
      );
      const row = forecast.rows[0];
      if (!row) throw new NotFoundException('Previsão não encontrada.');
      if (row.kind !== 'expense')
        throw new BadRequestException('Somente uma despesa prevista pode ser retida na fonte.');
      if (row.retained_at) return { retained: true };
      const unavailable = await client.query(
        `SELECT 1 FROM financial_forecasts f
         WHERE f.id=$1 AND (f.cancelled_at IS NOT NULL OR f.closed_at IS NOT NULL)
         UNION ALL
         SELECT 1 FROM forecast_reconciliations r
         WHERE r.forecast_id=$1 AND r.deleted_at IS NULL
         LIMIT 1`,
        [id],
      );
      if (unavailable.rowCount)
        throw new BadRequestException('Uma previsão encerrada ou conciliada não pode ser retida.');
      await client.query(
        'UPDATE financial_forecasts SET retained_at=NOW(),retained_amount=$2,updated_at=NOW() WHERE id=$1',
        [id, row.calculated_amount],
      );
      return { retained: true };
    });
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
    return this.queryDistributions(period);
  }

  private async queryDistributions(period: string, client?: PoolClient) {
    const sql = `WITH income_total AS (
         SELECT COALESCE(SUM(amount),0) amount FROM financial_forecasts
         WHERE kind='income' AND deleted_at IS NULL AND cancelled_at IS NULL AND to_char(due_date,'YYYY-MM')=$1
       ), global_repasses AS (
         SELECT DISTINCT ON(destination_id) destination_id,value_type,value
         FROM financial_repasses WHERE deleted_at IS NULL AND effective_from<=$1 AND (effective_to IS NULL OR effective_to>=$1)
         ORDER BY destination_id,effective_from DESC
       ), configured AS (
         SELECT destination_id,BOOL_OR(effective_from<=$1) AS has_started FROM financial_repasses GROUP BY destination_id
         ), has_global_rules AS (
           SELECT EXISTS(SELECT 1 FROM global_repasses) AS configured
       ), targets AS (
         SELECT d.id,d.name,COALESCE(fd.value_type,gr.value_type,'percentage') AS value_type,
             COALESCE(fd.value,gr.value,CASE WHEN h.configured OR COALESCE(c.has_started,FALSE) THEN 0::numeric ELSE
             CASE d.name WHEN 'Despesas gerais' THEN 70 WHEN 'Investimentos' THEN 10 WHEN 'Flávio' THEN 10 WHEN 'Laura' THEN 10 ELSE 0 END END) AS allocation_value
         FROM forecast_destinations d
         LEFT JOIN forecast_distributions fd ON fd.destination_id=d.id AND fd.period=$1
         LEFT JOIN global_repasses gr ON gr.destination_id=d.id
         LEFT JOIN configured c ON c.destination_id=d.id
           CROSS JOIN has_global_rules h
           WHERE d.active=TRUE
             AND (fd.destination_id IS NOT NULL OR gr.destination_id IS NOT NULL OR (NOT h.configured AND NOT COALESCE(c.has_started,FALSE)))
       )
       SELECT d.id,d.name,d.value_type AS "valueType",d.allocation_value::text AS value,
         CASE WHEN d.value_type='percentage' THEN d.allocation_value ELSE 0 END::text AS percentage,
         CASE WHEN d.value_type='percentage' THEN d.allocation_value*income_total.amount/100 ELSE d.allocation_value END::numeric(14,2)::text AS budget,
         COALESCE((SELECT SUM(e.amount) FROM cash_book_entries e
           JOIN financial_categories c ON c.id=e.category_id
           WHERE c.destination_id=d.id AND e.entry_type='expense' AND e.deleted_at IS NULL
             AND to_char(e.occurred_at,'YYYY-MM')=$1),0)::numeric(14,2)::text AS consumed
       FROM targets d CROSS JOIN income_total
       ORDER BY CASE d.name WHEN 'Despesas gerais' THEN 1 WHEN 'Investimentos' THEN 2 WHEN 'Flávio' THEN 3 WHEN 'Laura' THEN 4 WHEN 'Outras' THEN 5 ELSE 6 END,d.name`;
    const result = client
      ? await client.query<DistributionRow>(sql, [period])
      : await this.db.query<DistributionRow>(sql, [period]);
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
    await this.db.transaction(async (client) => {
      await this.persistDistributions(client, period, entries);
      await this.syncForecastsFromDistributions(client, period, entries);
    });
    return this.getDistributions(period);
  }

  private async persistDistributions(
    client: PoolClient,
    period: string,
    entries: { destinationId: string; percentage?: string; valueType?: 'percentage' | 'fixed'; value?: string }[],
  ) {
    const destinations = await client.query<{ id: string }>(
      'SELECT id FROM forecast_destinations WHERE id=ANY($1::uuid[]) AND active=TRUE',
      [entries.map((row) => row.destinationId)],
    );
    if (destinations.rowCount !== entries.length)
      throw new BadRequestException('Uma ou mais destinações não estão mais disponíveis. Recarregue a página.');

    await client.query('DELETE FROM forecast_distributions WHERE period=$1', [period]);
    for (const row of entries) {
      const valueType = row.valueType ?? 'percentage';
      const value = row.value ?? row.percentage ?? '0';
      const percentage = valueType === 'percentage' ? value : '0';
      await client.query(
        'INSERT INTO forecast_distributions(period,destination_id,percentage,value_type,value) VALUES($1,$2,$3,$4,$5)',
        [period, row.destinationId, percentage, valueType, value],
      );
    }
  }

  private async syncForecastsFromDistributions(
    client: PoolClient,
    period: string,
    entries: { destinationId: string; percentage?: string; valueType?: 'percentage' | 'fixed'; value?: string }[],
  ) {
    const startDate = `${period}-01`;
    for (const row of entries) {
      if ((row.valueType ?? 'percentage') !== 'percentage') continue;
      const percentage = row.value ?? row.percentage ?? '0';
      await client.query(
        `UPDATE financial_forecasts f
         SET percentage=$3,updated_at=NOW()
         FROM financial_categories c
         WHERE c.id=f.category_id AND c.destination_id=$1
           AND f.amount_type='income_percentage' AND f.deleted_at IS NULL AND f.cancelled_at IS NULL
           AND date_trunc('month',f.due_date)=date_trunc('month',$2::date)`,
        [row.destinationId, startDate, percentage],
      );
    }
  }

  private async syncDistributionForRepasse(
    client: PoolClient,
    period: string,
    destinationId: string,
    percentage: string,
  ) {
    await this.updateDistributionPeriod(client, period, destinationId, percentage);
  }

  private async updateDistributionPeriod(
    client: PoolClient,
    period: string,
    destinationId: string,
    percentage: string,
  ) {
    const rows = await this.queryDistributions(period, client);
    const entries = rebalanceDistributionRows(rows, destinationId, percentage);
    await this.persistDistributions(client, period, entries);
    await this.syncForecastsFromDistributions(client, period, entries);
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
    return this.saveDistributions(
      targetPeriod,
      (source as { id: string; percentage: string; valueType: 'percentage' | 'fixed'; value: string }[]).map((row) => ({
        destinationId: row.id,
        percentage: row.percentage,
        valueType: row.valueType,
        value: row.value,
      })),
    );
  }

  private async getOccurrence(id: string, includeCancelled = false) {
    const result = await this.db.query<ForecastRow>(
      `SELECT id,series_id,occurrence_index,due_date::text,kind,description,amount::text,category_id,account_id,destination_id,notes,group_id,amount_type,percentage::text FROM financial_forecasts WHERE id=$1 AND deleted_at IS NULL AND ($2::boolean OR cancelled_at IS NULL)`,
      [id, includeCancelled],
    );
    if (!result.rows[0])
      throw new NotFoundException('Previsão não encontrada.');
    return result.rows[0];
  }

  private previousPeriod(period: string) {
    const [year, month] = period.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 2, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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
