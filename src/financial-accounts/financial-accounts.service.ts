import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { rethrowDatabaseError } from '../common/database-errors.js';
import {
  CreateFinancialAccountDto,
  UpdateFinancialAccountDto,
} from './dto/financial-account.dto.js';

@Injectable()
export class FinancialAccountsService {
  constructor(private readonly database: DatabaseService) {}

  async findAll(active?: boolean) {
    const result =
      active === undefined
        ? await this.database.query(
            'SELECT id, name, type, institution, opening_balance::text AS "openingBalance", to_char(reference_date, \'YYYY-MM-DD\') AS "referenceDate", active FROM financial_accounts ORDER BY active DESC, name',
          )
        : await this.database.query(
            'SELECT id, name, type, institution, opening_balance::text AS "openingBalance", to_char(reference_date, \'YYYY-MM-DD\') AS "referenceDate", active FROM financial_accounts WHERE active = $1 ORDER BY name',
            [active],
          );
    return result.rows;
  }

  async create(input: CreateFinancialAccountDto) {
    if (!input.name.trim())
      throw new BadRequestException('O nome da conta é obrigatório.');
    try {
      const result = await this.database.query(
        `INSERT INTO financial_accounts (name, type, institution, opening_balance, reference_date)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, type, institution, opening_balance::text AS "openingBalance", to_char(reference_date, 'YYYY-MM-DD') AS "referenceDate", active`,
        [
          input.name.trim(),
          input.type,
          input.institution?.trim() || null,
          input.openingBalance,
          input.referenceDate,
        ],
      );
      return result.rows[0];
    } catch (error) {
      rethrowDatabaseError(error);
    }
  }

  async update(id: string, input: UpdateFinancialAccountDto) {
    if (input.name !== undefined && !input.name.trim())
      throw new BadRequestException('O nome da conta é obrigatório.');
    try {
      if (input.type) {
        const current = await this.database.query<{ type: string }>(
          'SELECT type FROM financial_accounts WHERE id=$1',
          [id],
        );
        if (current.rows[0] && current.rows[0].type !== input.type) {
          const used = await this.database.query(
            'SELECT 1 FROM investment_applications WHERE account_id=$1 LIMIT 1',
            [id],
          );
          if (used.rowCount)
            throw new BadRequestException(
              'O tipo de uma conta vinculada a aplicações não pode ser alterado.',
            );
        }
      }
      const result = await this.database.query(
        `UPDATE financial_accounts
         SET name = COALESCE($2, name), type = COALESCE($3, type),
             opening_balance = COALESCE($4::numeric, opening_balance),
             reference_date = COALESCE($5::date, reference_date),
             active = COALESCE($6, active), institution=CASE WHEN $7::boolean THEN $8 ELSE institution END, updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, type, institution, opening_balance::text AS "openingBalance", to_char(reference_date, 'YYYY-MM-DD') AS "referenceDate", active`,
        [
          id,
          input.name?.trim() ?? null,
          input.type ?? null,
          input.openingBalance ?? null,
          input.referenceDate ?? null,
          input.active ?? null,
          input.institution !== undefined,
          input.institution?.trim() || null,
        ],
      );
      if (!result.rowCount)
        throw new NotFoundException('Conta financeira não encontrada.');
      return result.rows[0];
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      rethrowDatabaseError(error);
    }
  }
}
