import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  assertPositiveAmount,
  rethrowDatabaseError,
} from '../common/database-errors.js';
import { DatabaseService } from '../database/database.service.js';
import { CreateTransferDto, UpdateTransferDto } from './dto/transfer.dto.js';

type TransferRecord = {
  id: string;
  occurred_at: string;
  description: string;
  amount: string;
  source_account_id: string;
  destination_account_id: string;
  source_application_id: string | null;
  destination_application_id: string | null;
  notes: string | null;
};

@Injectable()
export class TransfersService {
  constructor(private readonly database: DatabaseService) {}

  async create(input: CreateTransferDto) {
    if (!input.description.trim())
      throw new BadRequestException('A descrição é obrigatória.');
    assertPositiveAmount(input.amount);
    return this.database
      .transaction(async (client) => {
        const applications = await this.assertAccounts(
          client,
          input.sourceAccountId,
          input.destinationAccountId,
          input.occurredAt,
          input.sourceApplicationId,
          input.destinationApplicationId,
        );
        const transfer = await client.query<{ id: string }>(
          `INSERT INTO cash_book_transfers (occurred_at, description, amount, source_account_id, destination_account_id, notes, source_application_id, destination_application_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            input.occurredAt,
            input.description.trim(),
            input.amount,
            input.sourceAccountId,
            input.destinationAccountId,
            input.notes?.trim() || null,
            applications.source,
            applications.destination,
          ],
        );
        const transferId = transfer.rows[0].id;
        await client.query(
          `INSERT INTO cash_book_entries (account_id, transfer_id, entry_type, occurred_at, description, amount, notes)
         VALUES ($1, $2, 'transfer_debit', $3, $4, $5, $6), ($7, $2, 'transfer_credit', $3, $4, $5, $6)`,
          [
            input.sourceAccountId,
            transferId,
            input.occurredAt,
            input.description.trim(),
            input.amount,
            input.notes?.trim() || null,
            input.destinationAccountId,
          ],
        );
        await this.syncInvestmentMovements(
          client,
          transferId,
          input.occurredAt,
          input.description.trim(),
          input.amount,
          input.notes?.trim() || null,
          applications.source,
          applications.destination,
        );
        return this.findOneWithClient(client, transferId);
      })
      .catch((error: unknown) => rethrowDatabaseError(error));
  }

  async findOne(id: string) {
    const result = await this.database.query<TransferRecord>(
      `SELECT id, to_char(occurred_at, 'YYYY-MM-DD') AS occurred_at, description, amount::text AS amount,
         source_account_id, destination_account_id, notes, source_application_id, destination_application_id
       FROM cash_book_transfers WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!result.rows[0])
      throw new NotFoundException('Transferência não encontrada.');
    return this.toResponse(result.rows[0]);
  }

  async update(id: string, input: UpdateTransferDto) {
    try {
      return await this.database.transaction(async (client) => {
        const found = await client.query<TransferRecord>(
          `SELECT id, to_char(occurred_at, 'YYYY-MM-DD') AS occurred_at, description, amount::text AS amount,
             source_account_id, destination_account_id, notes, source_application_id, destination_application_id
           FROM cash_book_transfers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [id],
        );
        const current = found.rows[0];
        if (!current)
          throw new NotFoundException('Transferência não encontrada.');

        const sourceAccountId =
          input.sourceAccountId ?? current.source_account_id;
        const destinationAccountId =
          input.destinationAccountId ?? current.destination_account_id;
        const occurredAt = input.occurredAt ?? current.occurred_at;
        const amount = input.amount ?? current.amount;
        assertPositiveAmount(amount);
        const sourceApplicationId =
          input.sourceApplicationId === undefined
            ? current.source_application_id
            : input.sourceApplicationId;
        const destinationApplicationId =
          input.destinationApplicationId === undefined
            ? current.destination_application_id
            : input.destinationApplicationId;
        const applications = await this.assertAccounts(
          client,
          sourceAccountId,
          destinationAccountId,
          occurredAt,
          sourceApplicationId,
          destinationApplicationId,
        );
        const description = (input.description ?? current.description).trim();
        if (!description)
          throw new BadRequestException('A descrição é obrigatória.');
        const notes =
          input.notes === undefined
            ? current.notes
            : input.notes?.trim() || null;

        await client.query(
          `UPDATE cash_book_transfers SET occurred_at = $2, description = $3, amount = $4,
          source_account_id = $5, destination_account_id = $6, notes = $7, source_application_id=$8, destination_application_id=$9, updated_at = NOW() WHERE id = $1`,
          [
            id,
            occurredAt,
            description,
            amount,
            sourceAccountId,
            destinationAccountId,
            notes,
            applications.source,
            applications.destination,
          ],
        );
        await client.query(
          `UPDATE cash_book_entries SET account_id = $2, occurred_at = $3, description = $4, amount = $5,
           notes = $6, updated_at = NOW() WHERE transfer_id = $1 AND entry_type = 'transfer_debit' AND deleted_at IS NULL`,
          [id, sourceAccountId, occurredAt, description, amount, notes],
        );
        await this.syncInvestmentMovements(
          client,
          id,
          occurredAt,
          description,
          amount,
          notes,
          applications.source,
          applications.destination,
        );
        await client.query(
          `UPDATE cash_book_entries SET account_id = $2, occurred_at = $3, description = $4, amount = $5,
           notes = $6, updated_at = NOW() WHERE transfer_id = $1 AND entry_type = 'transfer_credit' AND deleted_at IS NULL`,
          [id, destinationAccountId, occurredAt, description, amount, notes],
        );
        return this.findOneWithClient(client, id);
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

  async remove(id: string) {
    const result = await this.database.transaction(async (client) => {
      const transfer = await client.query(
        'UPDATE cash_book_transfers SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
        [id],
      );
      if (!transfer.rowCount)
        throw new NotFoundException('Transferência não encontrada.');
      await client.query(
        'UPDATE cash_book_entries SET deleted_at = NOW(), updated_at = NOW() WHERE transfer_id = $1 AND deleted_at IS NULL',
        [id],
      );
      await client.query(
        'UPDATE investment_transactions SET deleted_at=NOW(),updated_at=NOW() WHERE transfer_id=$1 AND deleted_at IS NULL',
        [id],
      );
      return { deleted: true, transferId: id };
    });
    return result;
  }

  private async assertAccounts(
    client: PoolClient,
    source: string,
    destination: string,
    occurredAt: string,
    sourceApplicationId?: string | null,
    destinationApplicationId?: string | null,
  ) {
    if (source === destination)
      throw new BadRequestException(
        'A conta de origem e destino devem ser diferentes.',
      );
    const result = await client.query<{
      id: string;
      active: boolean;
      reference_date: string;
      type: string;
    }>(
      `SELECT id, active, to_char(reference_date, 'YYYY-MM-DD') AS reference_date,type
       FROM financial_accounts WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [[source, destination]],
    );
    if (
      result.rows.length !== 2 ||
      result.rows.some((account) => !account.active)
    ) {
      throw new BadRequestException(
        'Origem e destino devem ser contas financeiras ativas.',
      );
    }
    if (result.rows.some((account) => occurredAt < account.reference_date)) {
      throw new BadRequestException(
        'A transferência não pode ser anterior à data de referência do saldo inicial.',
      );
    }
    const sourceInvestment =
      result.rows.find((account) => account.id === source)?.type ===
      'investment';
    const destinationInvestment =
      result.rows.find((account) => account.id === destination)?.type ===
      'investment';
    if (
      sourceInvestment !== Boolean(sourceApplicationId) ||
      destinationInvestment !== Boolean(destinationApplicationId)
    ) {
      throw new BadRequestException(
        'Selecione uma aplicação para cada conta de investimento da transferência.',
      );
    }
    const applicationIds = [
      sourceApplicationId,
      destinationApplicationId,
    ].filter((value): value is string => Boolean(value));
    if (applicationIds.length) {
      const apps = await client.query<{
        id: string;
        account_id: string;
        reference_date: string;
        active: boolean;
      }>(
        `SELECT id,account_id,to_char(reference_date,'YYYY-MM-DD') reference_date,active FROM investment_applications WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL FOR UPDATE`,
        [applicationIds],
      );
      if (
        apps.rows.length !== applicationIds.length ||
        apps.rows.some(
          (app) =>
            !app.active ||
            app.account_id !==
              (app.id === sourceApplicationId ? source : destination) ||
            occurredAt < app.reference_date,
        )
      ) {
        throw new BadRequestException(
          'A aplicação selecionada deve estar ativa, pertencer à conta e ter data de referência anterior à transferência.',
        );
      }
    }
    return {
      source: sourceApplicationId ?? null,
      destination: destinationApplicationId ?? null,
    };
  }

  private async syncInvestmentMovements(
    client: PoolClient,
    id: string,
    occurredAt: string,
    description: string,
    amount: string,
    notes: string | null,
    sourceApplicationId: string | null,
    destinationApplicationId: string | null,
  ) {
    await client.query(
      'UPDATE investment_transactions SET deleted_at=NOW(),updated_at=NOW() WHERE transfer_id=$1 AND deleted_at IS NULL',
      [id],
    );
    if (sourceApplicationId)
      await client.query(
        `INSERT INTO investment_transactions(application_id,transfer_id,occurred_at,transaction_type,amount,origin,notes) VALUES($1,$2,$3,'withdrawal',$4,$5,$6)`,
        [sourceApplicationId, id, occurredAt, amount, description, notes],
      );
    if (destinationApplicationId)
      await client.query(
        `INSERT INTO investment_transactions(application_id,transfer_id,occurred_at,transaction_type,amount,origin,notes) VALUES($1,$2,$3,'contribution',$4,$5,$6)`,
        [destinationApplicationId, id, occurredAt, amount, description, notes],
      );
  }

  private async findOneWithClient(client: PoolClient, id: string) {
    const result = await client.query<TransferRecord>(
      `SELECT id, to_char(occurred_at, 'YYYY-MM-DD') AS occurred_at, description, amount::text AS amount,
         source_account_id, destination_account_id, notes, source_application_id, destination_application_id
       FROM cash_book_transfers WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!result.rows[0])
      throw new NotFoundException('Transferência não encontrada.');
    return this.toResponse(result.rows[0]);
  }

  private toResponse(transfer: TransferRecord) {
    return {
      id: transfer.id,
      occurredAt: transfer.occurred_at,
      description: transfer.description,
      amount: transfer.amount,
      sourceAccountId: transfer.source_account_id,
      destinationAccountId: transfer.destination_account_id,
      sourceApplicationId: transfer.source_application_id,
      destinationApplicationId: transfer.destination_application_id,
      notes: transfer.notes,
    };
  }
}
