import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { assertPositiveAmount, rethrowDatabaseError } from '../common/database-errors.js';
import { CreateCashBookEntryDto } from './dto/create-cash-book-entry.dto.js';
import { CashBookQueryDto } from './dto/cash-book-query.dto.js';
import { UpdateCashBookEntryDto } from './dto/update-cash-book-entry.dto.js';

type AccountLedgerContext = { id: string; name: string; type: string; active: boolean; opening_balance: string; reference_date: string };

@Injectable()
export class CashBookService {
  constructor(private readonly database: DatabaseService) {}

  private async account(id: string): Promise<AccountLedgerContext> {
    const result = await this.database.query<AccountLedgerContext>(
      `SELECT id, name, type, active, opening_balance::text AS opening_balance,
       to_char(reference_date, 'YYYY-MM-DD') AS reference_date FROM financial_accounts WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundException('Conta financeira não encontrada.');
    return result.rows[0];
  }

  async findAll(filters: CashBookQueryDto) {
    const account = await this.account(filters.accountId);
    const [year, month] = filters.month.split('-').map(Number);
    const monthStart = `${filters.month}-01`;
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const requestedStart = filters.fromDate && filters.fromDate > monthStart ? filters.fromDate : monthStart;
    const startDate = requestedStart < account.reference_date ? account.reference_date : requestedStart;
    const endInclusive = filters.toDate && filters.toDate < monthEnd ? filters.toDate : monthEnd;
    if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
      throw new BadRequestException('A data inicial deve ser anterior à data final.');
    }
    if (startDate > endInclusive) throw new BadRequestException('O período informado não contém datas válidas para esta conta.');
    const endExclusive = new Date(`${endInclusive}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const endDate = endExclusive.toISOString().slice(0, 10);
    const balance = await this.openingBalanceAt(account, startDate);

    const filterValues: unknown[] = [];
    const conditions: ((offset: number, outputAliases: boolean) => string)[] = [];
    if (filters.type === 'income') conditions.push((_, outputAliases) => `${outputAliases ? 'type' : 'entry_type'} = 'income'`);
    if (filters.type === 'expense') conditions.push((_, outputAliases) => `${outputAliases ? 'type' : 'entry_type'} = 'expense'`);
    if (filters.type === 'transfer') conditions.push((_, outputAliases) => `${outputAliases ? 'type' : 'entry_type'} IN ('transfer_debit', 'transfer_credit')`);
    if (filters.categoryId) {
      filterValues.push(filters.categoryId);
      const parameterIndex = filterValues.length;
      conditions.push((offset, outputAliases) => `${outputAliases ? '"categoryId"' : 'category_id'} = $${parameterIndex + offset}`);
    }
    if (filters.search?.trim()) {
      filterValues.push(`%${filters.search.trim()}%`);
      const parameterIndex = filterValues.length;
      conditions.push((offset, outputAliases) => `(description ILIKE $${parameterIndex + offset} OR ${outputAliases ? '"categoryName"' : 'category_name'} ILIKE $${parameterIndex + offset})`);
    }
    const filterSql = (offset: number, outputAliases: boolean) => conditions.length ? `WHERE ${conditions.map((condition) => condition(offset, outputAliases)).join(' AND ')}` : '';
    const count = await this.database.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM (
         SELECT e.id, e.entry_type, e.category_id, e.description, c.name AS category_name
         FROM cash_book_entries e LEFT JOIN financial_categories c ON c.id = e.category_id
         WHERE e.account_id = $1 AND e.deleted_at IS NULL AND e.occurred_at >= $2 AND e.occurred_at < $3
       ) records ${filterSql(3, false)}`,
      [account.id, startDate, endDate, ...filterValues],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    const values: unknown[] = [account.id, startDate, endDate, balance, ...filterValues];
    values.push(filters.pageSize, (filters.page - 1) * filters.pageSize);

    const result = await this.database.query(
      `WITH ledger AS (
         SELECT e.id, e.transfer_id AS "transferId", e.account_id AS "accountId", a.name AS "accountName",
           e.category_id AS "categoryId", c.name AS "categoryName", repasse.name AS "destinationName", e.entry_type AS type,
           t.source_account_id AS "sourceAccountId", source.name AS "sourceAccountName",
           t.destination_account_id AS "destinationAccountId", destination.name AS "destinationAccountName",
           t.source_application_id AS "sourceApplicationId", t.destination_application_id AS "destinationApplicationId",
           to_char(e.occurred_at, 'YYYY-MM-DD') AS "occurredAt", e.description,
           e.amount::text AS amount, e.notes, e.created_at AS "createdAt", e.updated_at AS "updatedAt",
           ($4::numeric + SUM(CASE WHEN e.entry_type IN ('income', 'transfer_credit') THEN e.amount ELSE -e.amount END)
             OVER (ORDER BY e.occurred_at, e.description COLLATE "C", e.entry_type, e.amount, e.id))::text AS balance
         FROM cash_book_entries e
         JOIN financial_accounts a ON a.id = e.account_id
         LEFT JOIN financial_categories c ON c.id = e.category_id
         LEFT JOIN forecast_destinations repasse ON repasse.id = c.destination_id
         LEFT JOIN cash_book_transfers t ON t.id = e.transfer_id
         LEFT JOIN financial_accounts source ON source.id = t.source_account_id
         LEFT JOIN financial_accounts destination ON destination.id = t.destination_account_id
         WHERE e.account_id = $1 AND e.deleted_at IS NULL AND e.occurred_at >= $2 AND e.occurred_at < $3
       )
       SELECT * FROM ledger ${filterSql(4, true)}
       ORDER BY "occurredAt", description COLLATE "C", type, amount, id
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      entries: result.rows,
      pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.max(1, Math.ceil(total / filters.pageSize)) },
      period: { month: filters.month, fromDate: startDate, toDate: endInclusive },
    };
  }

  async summary(accountId: string, monthValue: string) {
    const account = await this.account(accountId);
    const [year, month] = monthValue.split('-').map(Number);
    const monthStart = `${monthValue}-01`;
    const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const result = await this.database.query(
      `SELECT a.id AS "accountId", a.name AS "accountName", a.type AS "accountType",
         CASE WHEN $2::date < a.reference_date THEN 0::numeric
           ELSE a.opening_balance + COALESCE((
             SELECT SUM(CASE WHEN e.entry_type IN ('income', 'transfer_credit') THEN e.amount ELSE -e.amount END)
             FROM cash_book_entries e WHERE e.account_id = a.id AND e.deleted_at IS NULL
               AND e.occurred_at >= a.reference_date AND e.occurred_at < $2
           ), 0::numeric) END::text AS "openingBalance",
         COALESCE(SUM(e.amount) FILTER (WHERE e.entry_type = 'income'), 0)::text AS "incomeTotal",
         COALESCE(SUM(e.amount) FILTER (WHERE e.entry_type = 'expense'), 0)::text AS "expenseTotal",
         COALESCE(SUM(CASE WHEN e.entry_type IN ('income', 'transfer_credit') THEN e.amount
                           WHEN e.entry_type IN ('expense', 'transfer_debit') THEN -e.amount ELSE 0 END), 0)::text AS "netMovement"
       FROM financial_accounts a
       LEFT JOIN cash_book_entries e ON e.account_id = a.id AND e.deleted_at IS NULL
         AND e.occurred_at >= GREATEST($2::date, a.reference_date) AND e.occurred_at < $3::date
       WHERE a.id = $1
       GROUP BY a.id`,
      [account.id, monthStart, nextMonth],
    );
    const values = result.rows[0] as Record<string, string>;
    return {
      ...values,
      closingBalance: this.addDecimalStrings(values.openingBalance, values.netMovement),
      month: monthValue,
      referenceDate: account.reference_date,
    };
  }

  async findOne(id: string) {
    const result = await this.database.query(
      `SELECT e.id, e.transfer_id AS "transferId", e.account_id AS "accountId", a.name AS "accountName",
         e.category_id AS "categoryId", c.name AS "categoryName", repasse.name AS "destinationName", e.entry_type AS type,
         t.source_application_id AS "sourceApplicationId", t.destination_application_id AS "destinationApplicationId",
         to_char(e.occurred_at, 'YYYY-MM-DD') AS "occurredAt", e.description, e.amount::text AS amount,
         e.notes, e.created_at AS "createdAt", e.updated_at AS "updatedAt"
       FROM cash_book_entries e JOIN financial_accounts a ON a.id = e.account_id
       LEFT JOIN financial_categories c ON c.id = e.category_id
       LEFT JOIN forecast_destinations repasse ON repasse.id = c.destination_id
       LEFT JOIN cash_book_transfers t ON t.id = e.transfer_id
       WHERE e.id = $1 AND e.deleted_at IS NULL`, [id],
    );
    if (!result.rows[0]) throw new NotFoundException('Lançamento não encontrado.');
    return result.rows[0];
  }

  async create(input: CreateCashBookEntryDto) {
    if (!input.description.trim()) throw new BadRequestException('A descrição é obrigatória.');
    assertPositiveAmount(input.amount);
    await this.assertValidReferences(input.accountId, input.categoryId, input.type, input.occurredAt);
    try {
      const result = await this.database.query(
        `INSERT INTO cash_book_entries (account_id, category_id, entry_type, occurred_at, description, amount, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, account_id AS "accountId", category_id AS "categoryId", entry_type AS type,
           to_char(occurred_at, 'YYYY-MM-DD') AS "occurredAt", description, amount::text AS amount,
           notes, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [input.accountId, input.categoryId, input.type, input.occurredAt, input.description.trim(), input.amount, input.notes?.trim() || null],
      );
      return result.rows[0];
    } catch (error) {
      rethrowDatabaseError(error);
    }
  }

  async update(id: string, input: UpdateCashBookEntryDto) {
    const current = await this.findOne(id) as Record<string, string | null>;
    if (current.transferId) throw new BadRequestException('Edite transferências pela operação de transferência.');
    const type = input.type ?? current.type as 'income' | 'expense';
    const accountId = input.accountId ?? current.accountId as string;
    const categoryId = input.categoryId ?? current.categoryId as string;
    const occurredAt = input.occurredAt ?? current.occurredAt as string;
    const amount = input.amount ?? current.amount as string;
    if (!(input.description ?? current.description as string).trim()) throw new BadRequestException('A descrição é obrigatória.');
    assertPositiveAmount(amount);
    await this.assertValidReferences(accountId, categoryId, type, occurredAt);
    try {
      const result = await this.database.query(
        `UPDATE cash_book_entries SET account_id = $2, category_id = $3, entry_type = $4,
         occurred_at = $5, description = $6, amount = $7, notes = $8, updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, account_id AS "accountId", category_id AS "categoryId", entry_type AS type,
         to_char(occurred_at, 'YYYY-MM-DD') AS "occurredAt", description, amount::text AS amount,
         notes, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, accountId, categoryId, type, occurredAt, (input.description ?? current.description as string).trim(), amount,
          input.notes === undefined ? current.notes : input.notes?.trim() || null],
      );
      return result.rows[0];
    } catch (error) {
      rethrowDatabaseError(error);
    }
  }

  async remove(id: string) {
    const entry = await this.findOne(id) as { transferId?: string | null };
    if (entry.transferId) {
      return this.database.transaction(async (client) => {
        await client.query('UPDATE cash_book_transfers SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [entry.transferId]);
        await client.query('UPDATE cash_book_entries SET deleted_at = NOW(), updated_at = NOW() WHERE transfer_id = $1 AND deleted_at IS NULL', [entry.transferId]);
        return { deleted: true, transferId: entry.transferId };
      });
    }
    const result = await this.database.query('UPDATE cash_book_entries SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id', [id]);
    if (!result.rowCount) throw new NotFoundException('Lançamento não encontrado.');
    return { deleted: true, id };
  }

  private async assertValidReferences(accountId: string, categoryId: string, type: 'income' | 'expense', occurredAt: string) {
    const account = await this.database.query<{ reference_date: string }>(
      `SELECT to_char(reference_date, 'YYYY-MM-DD') AS reference_date FROM financial_accounts WHERE id = $1 AND active = TRUE`, [accountId],
    );
    if (!account.rows[0]) throw new BadRequestException('Selecione uma conta financeira ativa.');
    if (occurredAt < account.rows[0].reference_date) throw new BadRequestException('A movimentação não pode ser anterior à data de referência do saldo inicial.');
    const category = await this.database.query<{ nature: string }>(
      'SELECT nature FROM financial_categories WHERE id = $1 AND active = TRUE', [categoryId],
    );
    if (!category.rows[0] || category.rows[0].nature !== type) {
      throw new BadRequestException('Selecione uma categoria ativa compatível com o tipo da movimentação.');
    }
  }

  private async openingBalanceAt(account: AccountLedgerContext, beforeDate: string) {
    const result = await this.database.query<{ balance: string }>(
      `SELECT CASE WHEN $2::date < reference_date THEN 0::numeric
        ELSE opening_balance + COALESCE((
          SELECT SUM(CASE WHEN entry_type IN ('income', 'transfer_credit') THEN amount ELSE -amount END)
          FROM cash_book_entries WHERE account_id = $1 AND deleted_at IS NULL
            AND occurred_at >= reference_date AND occurred_at < $2
        ), 0::numeric) END::text AS balance
       FROM financial_accounts WHERE id = $1`,
      [account.id, beforeDate],
    );
    return result.rows[0]?.balance ?? '0.00';
  }

  private addDecimalStrings(left: string, right: string) {
    const toCents = (value: string) => {
      const negative = value.startsWith('-');
      const [whole, fraction = ''] = value.replace('-', '').split('.');
      const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
      return negative ? -cents : cents;
    };
    const cents = toCents(left) + toCents(right);
    const sign = cents < 0n ? '-' : '';
    const absolute = cents < 0n ? -cents : cents;
    return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
  }
}
