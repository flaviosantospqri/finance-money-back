import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { InvestmentEvolutionQueryDto } from './dto/investment-evolution-query.dto.js';

@Injectable()
export class InvestmentEvolutionService {
  constructor(private readonly database: DatabaseService) {}

  private range(query: InvestmentEvolutionQueryDto) {
    const year = query.year ?? new Date().getFullYear().toString();
    const from = query.fromMonth ?? `${year}-01`;
    const to = query.toMonth ?? `${year}-12`;
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to))
      throw new BadRequestException('Informe o período no formato AAAA-MM.');
    const fromMonth = Number(from.split('-')[1]);
    const toMonth = Number(to.split('-')[1]);
    if (fromMonth < 1 || fromMonth > 12 || toMonth < 1 || toMonth > 12 || from > to)
      throw new BadRequestException('O período informado é inválido.');
    return { from, to };
  }

  async monthly(query: InvestmentEvolutionQueryDto) {
    const { from, to } = this.range(query);
    const result = await this.database.query(
      `WITH selected AS (
         SELECT a.id
         FROM investment_applications a
         WHERE a.deleted_at IS NULL AND ($3::uuid IS NULL OR a.account_id=$3) AND ($4::uuid IS NULL OR a.id=$4)
       ), months AS (
         SELECT month_start::date AS month_start,(month_start+INTERVAL '1 month'-INTERVAL '1 day')::date AS month_end
         FROM generate_series(date_trunc('month',$1::date),date_trunc('month',$2::date),INTERVAL '1 month') month_start
       ), movements AS (
         SELECT t.*,x.source_application_id,x.destination_application_id
         FROM investment_transactions t JOIN selected s ON s.id=t.application_id
         LEFT JOIN cash_book_transfers x ON x.id=t.transfer_id AND x.deleted_at IS NULL
         WHERE t.deleted_at IS NULL
       ), internal_transfer AS (
         SELECT id, (source_application_id IN (SELECT id FROM selected) AND destination_application_id IN (SELECT id FROM selected)) AS is_internal
         FROM movements WHERE transfer_id IS NOT NULL
       ), monthly_flows AS (
         SELECT date_trunc('month',m.occurred_at)::date AS month_start,
           SUM(m.amount) FILTER(WHERE m.transaction_type='contribution' AND NOT COALESCE(i.is_internal,FALSE)) AS contributions,
           SUM(m.amount) FILTER(WHERE m.transaction_type='withdrawal' AND NOT COALESCE(i.is_internal,FALSE)) AS withdrawals,
           SUM(m.amount) FILTER(WHERE m.transaction_type='refund' AND NOT COALESCE(i.is_internal,FALSE)) AS refunds,
           SUM(m.amount) FILTER(WHERE m.transaction_type='income') AS income
         FROM movements m LEFT JOIN internal_transfer i ON i.id=m.id
         GROUP BY 1
       ), positions AS (
         SELECT mo.month_start,mo.month_end,
           COALESCE((SELECT SUM(CASE WHEN t.transaction_type IN ('contribution','income') THEN t.amount WHEN t.transaction_type IN ('withdrawal','refund') THEN -t.amount ELSE t.amount END)
             FROM movements t WHERE t.application_id IN (SELECT id FROM selected) AND t.occurred_at<=mo.month_end),0) AS ending_balance
         FROM months mo
       )
       SELECT to_char(p.month_start,'YYYY-MM') AS month,
         COALESCE(f.contributions,0)::numeric(14,2)::text AS contributions,
         COALESCE(f.withdrawals,0)::numeric(14,2)::text AS withdrawals,
         COALESCE(f.refunds,0)::numeric(14,2)::text AS refunds,
         COALESCE(f.income,0)::numeric(14,2)::text AS income,
         p.ending_balance::numeric(14,2)::text AS "endingBalance"
       FROM positions p LEFT JOIN monthly_flows f USING(month_start)
       WHERE EXISTS (SELECT 1 FROM selected) ORDER BY p.month_start`,
      [`${from}-01`, `${to}-01`, query.accountId ?? null, query.applicationId ?? null],
    );
    return result.rows;
  }

  async summary(query: InvestmentEvolutionQueryDto) {
    const rows = await this.monthly(query);
    const { from, to } = this.range(query);
    const opening = await this.database.query(
      `SELECT COALESCE(SUM(CASE WHEN t.transaction_type IN ('contribution','income') THEN t.amount WHEN t.transaction_type IN ('withdrawal','refund') THEN -t.amount ELSE t.amount END),0)::numeric(14,2)::text AS balance
       FROM investment_transactions t JOIN investment_applications a ON a.id=t.application_id
       WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL AND t.occurred_at<$1::date AND ($2::uuid IS NULL OR a.account_id=$2) AND ($3::uuid IS NULL OR a.id=$3)`,
      [`${from}-01`, query.accountId ?? null, query.applicationId ?? null],
    );
    const endBalance = rows.at(-1)?.endingBalance ?? '0.00';
    const totals = await this.database.query(
      `SELECT COALESCE(SUM(t.amount) FILTER(WHERE t.transaction_type='income'),0)::numeric(14,2)::text AS income,
         COALESCE(SUM(t.amount) FILTER(WHERE t.transaction_type='contribution' AND NOT (
           COALESCE(x.source_application_id IN (SELECT id FROM investment_applications WHERE deleted_at IS NULL AND ($3::uuid IS NULL OR account_id=$3) AND ($4::uuid IS NULL OR id=$4)),FALSE)
           AND COALESCE(x.destination_application_id IN (SELECT id FROM investment_applications WHERE deleted_at IS NULL AND ($3::uuid IS NULL OR account_id=$3) AND ($4::uuid IS NULL OR id=$4)),FALSE)
         )),0)::numeric(14,2)::text AS contributions
         ,COALESCE(SUM(t.amount) FILTER(WHERE t.transaction_type='refund'),0)::numeric(14,2)::text AS refunds
       FROM investment_transactions t JOIN investment_applications a ON a.id=t.application_id
       LEFT JOIN cash_book_transfers x ON x.id=t.transfer_id AND x.deleted_at IS NULL
       WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL AND t.occurred_at>=date_trunc('month',$1::date) AND t.occurred_at<(date_trunc('month',$2::date)+INTERVAL '1 month')
         AND ($3::uuid IS NULL OR a.account_id=$3) AND ($4::uuid IS NULL OR a.id=$4)`,
      [`${from}-01`, `${to}-01`, query.accountId ?? null, query.applicationId ?? null],
    );
    const closeCents = this.toCents(endBalance);
    const openCents = this.toCents(opening.rows[0]?.balance ?? '0');
    return {
      fromMonth: from,
      toMonth: to,
      endingBalance: endBalance,
      openingBalance: opening.rows[0]?.balance ?? '0.00',
      contributions: totals.rows[0]?.contributions ?? '0.00',
      refunds: totals.rows[0]?.refunds ?? '0.00',
      income: totals.rows[0]?.income ?? '0.00',
      variation: this.fromCents(closeCents - openCents),
    };
  }

  private toCents(value: string) {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  }

  private fromCents(value: bigint) {
    const sign = value < 0n ? '-' : '';
    const absolute = value < 0n ? -value : value;
    return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
  }
}
