import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { rethrowDatabaseError } from '../common/database-errors.js';
import { DatabaseService } from '../database/database.service.js';
import {
  CreateInvestmentApplicationDto,
  CreateInvestmentTransactionDto,
  InvestmentQueryDto,
  UpdateInvestmentApplicationDto,
  UpdateInvestmentTransactionDto,
} from './dto/investment.dto.js';

@Injectable()
export class InvestmentsService {
  constructor(private readonly database: DatabaseService) {}

  async findAll(active?: boolean) {
    const result = await this.database.query(
      `SELECT a.id,a.name,a.account_id AS "accountId",fa.name AS "accountName",a.investment_type AS "investmentType",
        COALESCE(a.institution,fa.institution) AS institution,a.opening_balance::text AS "openingBalance",to_char(a.reference_date,'YYYY-MM-DD') AS "referenceDate",
        a.notes,a.active,a.deleted_at IS NOT NULL AS "deleted",
        CASE WHEN CURRENT_DATE<a.reference_date THEN 0::numeric ELSE a.opening_balance+COALESCE((SELECT SUM(CASE WHEN t.transaction_type IN ('contribution','income') THEN t.amount WHEN t.transaction_type='withdrawal' THEN -t.amount ELSE t.amount END)
          FROM investment_transactions t WHERE t.application_id=a.id AND t.deleted_at IS NULL AND t.occurred_at>=a.reference_date AND t.occurred_at<=CURRENT_DATE),0) END::text AS balance
       FROM investment_applications a JOIN financial_accounts fa ON fa.id=a.account_id
       WHERE a.deleted_at IS NULL AND ($1::boolean IS NULL OR a.active=$1) ORDER BY a.active DESC,a.name`,
      [active ?? null],
    );
    return result.rows;
  }

  async create(input: CreateInvestmentApplicationDto) {
    this.requireText(input.name, 'O nome da aplicação é obrigatório.');
    this.requireText(
      input.investmentType,
      'O tipo de investimento é obrigatório.',
    );
    try {
      const result = await this.database.query(
        `INSERT INTO investment_applications(name,account_id,investment_type,institution,opening_balance,reference_date,notes)
         SELECT $1,fa.id,$3,$4,$5,$6,$7 FROM financial_accounts fa WHERE fa.id=$2 AND fa.type='investment' AND fa.active=TRUE
         RETURNING id,name,account_id AS "accountId",investment_type AS "investmentType",institution,opening_balance::text AS "openingBalance",to_char(reference_date,'YYYY-MM-DD') AS "referenceDate",notes,active`,
        [
          input.name.trim(),
          input.accountId,
          input.investmentType.trim(),
          input.institution?.trim() || null,
          input.openingBalance,
          input.referenceDate,
          input.notes?.trim() || null,
        ],
      );
      if (!result.rowCount)
        throw new BadRequestException(
          'Selecione uma conta de investimento ativa.',
        );
      return result.rows[0];
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      rethrowDatabaseError(error);
    }
  }

  async findOne(id: string) {
    const result = await this.database.query(
      `SELECT a.id,a.name,a.account_id AS "accountId",fa.name AS "accountName",a.investment_type AS "investmentType",COALESCE(a.institution,fa.institution) AS institution,
        a.opening_balance::text AS "openingBalance",to_char(a.reference_date,'YYYY-MM-DD') AS "referenceDate",a.notes,a.active
       FROM investment_applications a JOIN financial_accounts fa ON fa.id=a.account_id WHERE a.id=$1 AND a.deleted_at IS NULL`,
      [id],
    );
    if (!result.rows[0])
      throw new NotFoundException('Aplicação não encontrada.');
    return result.rows[0];
  }

  async update(id: string, input: UpdateInvestmentApplicationDto) {
    if (input.name !== undefined)
      this.requireText(input.name, 'O nome da aplicação é obrigatório.');
    if (input.investmentType !== undefined)
      this.requireText(
        input.investmentType,
        'O tipo de investimento é obrigatório.',
      );
    try {
      return await this.database.transaction(async (client) => {
        const current = await client.query<{ account_id: string }>(
          'SELECT account_id FROM investment_applications WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
          [id],
        );
        if (!current.rows[0])
          throw new NotFoundException('Aplicação não encontrada.');
        if (input.accountId && input.accountId !== current.rows[0].account_id) {
          const linked = await client.query(
            'SELECT 1 FROM investment_transactions WHERE application_id=$1 AND transfer_id IS NOT NULL LIMIT 1',
            [id],
          );
          if (linked.rowCount)
            throw new BadRequestException(
              'A conta de uma aplicação com transferências vinculadas não pode ser alterada.',
            );
        }
        if (input.referenceDate) {
          const firstMovement = await client.query<{
            first_date: string | null;
          }>(
            `SELECT to_char(MIN(occurred_at),'YYYY-MM-DD') AS first_date FROM investment_transactions WHERE application_id=$1 AND deleted_at IS NULL`,
            [id],
          );
          const firstMovementDate = firstMovement.rows[0]?.first_date;
          if (firstMovementDate && input.referenceDate > firstMovementDate) {
            const [year, month, day] = firstMovementDate.split('-');
            throw new BadRequestException(
              `A data de referência não pode ser posterior a ${day}/${month}/${year}, data da primeira movimentação desta aplicação. Escolha uma data igual ou anterior ou ajuste as movimentações existentes.`,
            );
          }
        }
        if (input.accountId)
          await this.assertInvestmentAccount(client, input.accountId);
        const result = await client.query(
          `UPDATE investment_applications SET name=COALESCE($2,name),account_id=COALESCE($3,account_id),investment_type=COALESCE($4,investment_type),
           institution=CASE WHEN $5::boolean THEN $6 ELSE institution END,opening_balance=COALESCE($7::numeric,opening_balance),
           reference_date=COALESCE($8::date,reference_date),notes=CASE WHEN $9::boolean THEN $10 ELSE notes END,active=COALESCE($11,active),updated_at=NOW()
           WHERE id=$1 AND deleted_at IS NULL RETURNING id,name,account_id AS "accountId",investment_type AS "investmentType",institution,opening_balance::text AS "openingBalance",to_char(reference_date,'YYYY-MM-DD') AS "referenceDate",notes,active`,
          [
            id,
            input.name?.trim() ?? null,
            input.accountId ?? null,
            input.investmentType?.trim() ?? null,
            input.institution !== undefined,
            input.institution?.trim() || null,
            input.openingBalance ?? null,
            input.referenceDate ?? null,
            input.notes !== undefined,
            input.notes?.trim() || null,
            input.active ?? null,
          ],
        );
        return result.rows[0];
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      rethrowDatabaseError(error);
    }
  }

  async summary(query: InvestmentQueryDto) {
    const [year, month] = query.month.split('-').map(Number);
    const endDate = `${query.month}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
    const result = await this.database.query(
      `WITH selected AS (SELECT id,opening_balance,reference_date FROM investment_applications WHERE deleted_at IS NULL AND active=TRUE AND ($2::uuid IS NULL OR account_id=$2) AND ($3::uuid IS NULL OR id=$3)),
       movement AS (SELECT t.*,CASE WHEN t.transaction_type IN ('contribution','income') THEN t.amount WHEN t.transaction_type='withdrawal' THEN -t.amount ELSE t.amount END signed_amount FROM investment_transactions t JOIN selected s ON s.id=t.application_id WHERE t.deleted_at IS NULL)
       SELECT COALESCE((SELECT SUM(CASE WHEN $1::date<s.reference_date THEN 0::numeric ELSE s.opening_balance+COALESCE((SELECT SUM(m.signed_amount) FROM movement m WHERE m.application_id=s.id AND m.occurred_at>=s.reference_date AND m.occurred_at<=$1::date),0) END) FROM selected s),0)::text AS "investedBalance",
       COALESCE(SUM(amount) FILTER(WHERE transaction_type='contribution' AND occurred_at>=date_trunc('month',$1::date)::date AND occurred_at<=$1::date),0)::text AS contributions,
       COALESCE(SUM(amount) FILTER(WHERE transaction_type='withdrawal' AND occurred_at>=date_trunc('month',$1::date)::date AND occurred_at<=$1::date),0)::text AS withdrawals,
       COALESCE(SUM(amount) FILTER(WHERE transaction_type='income' AND occurred_at>=date_trunc('month',$1::date)::date AND occurred_at<=$1::date),0)::text AS income
       FROM movement`,
      [endDate, query.accountId ?? null, query.applicationId ?? null],
    );
    return { ...result.rows[0], month: query.month, asOf: endDate };
  }

  async transactions(applicationId: string, month?: string) {
    const app = await this.database.query<{
      opening_balance: string;
      reference_date: string;
    }>(
      `SELECT opening_balance::text,to_char(reference_date,'YYYY-MM-DD') reference_date FROM investment_applications WHERE id=$1 AND deleted_at IS NULL`,
      [applicationId],
    );
    if (!app.rows[0]) throw new NotFoundException('Aplicação não encontrada.');
    const period = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
    const result = await this.database.query(
      `WITH movements AS (SELECT t.id,t.application_id,t.transfer_id,t.occurred_at AS movement_date,to_char(t.occurred_at,'YYYY-MM-DD') AS "occurredAt",t.transaction_type AS type,t.amount::text AS amount,t.origin,t.notes,
        CASE WHEN t.transaction_type IN ('contribution','income') THEN t.amount WHEN t.transaction_type='withdrawal' THEN -t.amount ELSE t.amount END signed,
        t.created_at FROM investment_transactions t WHERE t.application_id=$1 AND t.deleted_at IS NULL AND t.occurred_at >= $3::date),
       balances AS (SELECT m.*,($2::numeric+SUM(m.signed) OVER(ORDER BY m."occurredAt",m.created_at,m.id))::text AS balance FROM movements m)
       SELECT id,"occurredAt",type,amount,origin,notes,balance,transfer_id AS "transferId" FROM balances
       WHERE ($4::date IS NULL OR movement_date>=date_trunc('month',$4::date)::date) AND ($5::date IS NULL OR movement_date<(date_trunc('month',$5::date)+INTERVAL '1 month'))
       ORDER BY "occurredAt" DESC,created_at DESC,id DESC`,
      [
        applicationId,
        app.rows[0].opening_balance,
        app.rows[0].reference_date,
        period ? `${period}-01` : null,
        period ? `${period}-01` : null,
      ],
    );
    return result.rows;
  }

  async createTransaction(
    applicationId: string,
    input: CreateInvestmentTransactionDto,
  ) {
    if (input.type === 'income' && this.cents(input.amount) <= 0n)
      throw new BadRequestException('O rendimento deve ser maior que zero.');
    if (input.type === 'adjustment' && this.cents(input.amount) === 0n)
      throw new BadRequestException('O ajuste deve ser diferente de zero.');
    if (
      input.type === 'adjustment' &&
      !input.notes?.trim() &&
      !input.origin?.trim()
    )
      throw new BadRequestException('Informe uma justificativa para o ajuste.');
    try {
      return await this.database.transaction(async (client) => {
        await this.assertApplicationDate(
          client,
          applicationId,
          input.occurredAt,
        );
        const result = await client.query(
          `INSERT INTO investment_transactions(application_id,occurred_at,transaction_type,amount,origin,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,application_id AS "applicationId",to_char(occurred_at,'YYYY-MM-DD') AS "occurredAt",transaction_type AS type,amount::text,origin,notes`,
          [
            applicationId,
            input.occurredAt,
            input.type,
            input.amount,
            input.origin?.trim() || null,
            input.notes?.trim() || null,
          ],
        );
        return result.rows[0];
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      rethrowDatabaseError(error);
    }
  }

  async updateTransaction(id: string, input: UpdateInvestmentTransactionDto) {
    try {
      return await this.database.transaction(async (client) => {
        const found = await client.query<{
          application_id: string;
          transfer_id: string | null;
          occurred_at: string;
          transaction_type: 'income' | 'adjustment';
          amount: string;
          origin: string | null;
          notes: string | null;
        }>(
          `SELECT application_id,transfer_id,to_char(occurred_at,'YYYY-MM-DD') occurred_at,transaction_type,amount::text,origin,notes FROM investment_transactions WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
          [id],
        );
        const old = found.rows[0];
        if (!old) throw new NotFoundException('Movimentação não encontrada.');
        if (old.transfer_id)
          throw new BadRequestException(
            'Aporte ou resgate vinculado deve ser alterado pela transferência no Livro Caixa.',
          );
        const type = input.type ?? old.transaction_type;
        const amount = input.amount ?? old.amount;
        const notes =
          input.notes === undefined ? old.notes : input.notes?.trim() || null;
        const origin =
          input.origin === undefined
            ? old.origin
            : input.origin?.trim() || null;
        if (
          (type === 'income' && this.cents(amount) <= 0n) ||
          (type === 'adjustment' && this.cents(amount) === 0n)
        )
          throw new BadRequestException(
            'Informe um valor válido para a movimentação.',
          );
        if (type === 'adjustment' && !notes && !origin)
          throw new BadRequestException(
            'Informe uma justificativa para o ajuste.',
          );
        await this.assertApplicationDate(
          client,
          old.application_id,
          input.occurredAt ?? old.occurred_at,
        );
        const updated = await client.query(
          `UPDATE investment_transactions SET occurred_at=COALESCE($2::date,occurred_at),transaction_type=$3,amount=$4,origin=$5,notes=$6,updated_at=NOW() WHERE id=$1 RETURNING id,application_id AS "applicationId",to_char(occurred_at,'YYYY-MM-DD') AS "occurredAt",transaction_type AS type,amount::text,origin,notes`,
          [id, input.occurredAt ?? null, type, amount, origin, notes],
        );
        return updated.rows[0];
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      rethrowDatabaseError(error);
    }
  }

  async removeTransaction(id: string) {
    const result = await this.database.query(
      `UPDATE investment_transactions SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL AND transfer_id IS NULL RETURNING id`,
      [id],
    );
    if (!result.rowCount) {
      const found = await this.database.query(
        'SELECT transfer_id FROM investment_transactions WHERE id=$1 AND deleted_at IS NULL',
        [id],
      );
      if (found.rowCount)
        throw new BadRequestException(
          'Aporte ou resgate vinculado deve ser excluído pela transferência no Livro Caixa.',
        );
      throw new NotFoundException('Movimentação não encontrada.');
    }
    return { deleted: true, id };
  }

  private async assertApplicationDate(
    client: PoolClient,
    id: string,
    date: string,
  ) {
    const result = await client.query<{ reference_date: string }>(
      `SELECT to_char(reference_date,'YYYY-MM-DD') reference_date FROM investment_applications WHERE id=$1 AND active=TRUE AND deleted_at IS NULL FOR UPDATE`,
      [id],
    );
    if (!result.rows[0])
      throw new NotFoundException('Aplicação ativa não encontrada.');
    if (date < result.rows[0].reference_date)
      throw new BadRequestException(
        'A movimentação não pode ser anterior à data de referência da aplicação.',
      );
  }
  private async assertInvestmentAccount(client: PoolClient, id: string) {
    const result = await client.query(
      `SELECT 1 FROM financial_accounts WHERE id=$1 AND active=TRUE AND type='investment'`,
      [id],
    );
    if (!result.rowCount)
      throw new BadRequestException(
        'Selecione uma conta de investimento ativa.',
      );
  }
  private requireText(value: string, message: string) {
    if (!value.trim()) throw new BadRequestException(message);
  }
  private cents(value: string) {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = value.replace('-', '').split('.');
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return negative ? -cents : cents;
  }
}
