import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { RepasseInputDto } from './dto/repasse.dto.js';

type RepasseRow = { id: string; destination_id: string; name: string; value_type: 'percentage' | 'fixed'; value: string; effective_from: string; effective_to: string | null };

@Injectable()
export class RepassesService {
  constructor(private readonly database: DatabaseService) {}

  async list() {
    const result = await this.database.query(
      `SELECT r.id,r.destination_id AS "destinationId",d.name,r.value_type AS "valueType",r.value::text,
        r.effective_from AS "effectiveFrom",r.effective_to AS "effectiveTo"
       FROM financial_repasses r JOIN forecast_destinations d ON d.id=r.destination_id
       WHERE r.deleted_at IS NULL ORDER BY d.name,r.effective_from DESC`,
    );
    return result.rows;
  }

  async create(input: RepasseInputDto) {
    this.validate(input);
    const currentPeriod = this.currentPeriod();
    if (input.effectiveFrom < currentPeriod)
      throw new BadRequestException('A vigência global deve começar neste mês ou em um mês futuro. Para alterar o histórico, ajuste a distribuição naquela competência.');
    return this.database.transaction(async (client) => {
      const destinationId = await this.destination(client, input.name);
      await this.assertNoOverlap(client, destinationId, input.effectiveFrom, input.effectiveTo ?? null);
      const result = await client.query(
        `INSERT INTO financial_repasses(destination_id,value_type,value,effective_from,effective_to)
         VALUES($1,$2,$3,$4,$5) RETURNING id,destination_id AS "destinationId",value_type AS "valueType",value::text,effective_from AS "effectiveFrom",effective_to AS "effectiveTo"`,
        [destinationId, input.valueType, input.value, input.effectiveFrom, input.effectiveTo || null],
      );
      return { ...result.rows[0], name: input.name.trim() };
    });
  }

  async update(id: string, input: RepasseInputDto) {
    this.validate(input);
    const currentPeriod = this.currentPeriod();
    if (input.effectiveFrom < currentPeriod)
      throw new BadRequestException('A vigência global não pode alterar meses passados. Use a distribuição da competência para ajustar o histórico.');
    return this.database.transaction(async (client) => {
      const found = await client.query<RepasseRow>(
        `SELECT r.id,r.destination_id,d.name,r.value_type,r.value::text,r.effective_from,r.effective_to
         FROM financial_repasses r JOIN forecast_destinations d ON d.id=r.destination_id
         WHERE r.id=$1 AND r.deleted_at IS NULL FOR UPDATE OF r`, [id],
      );
      const previous = found.rows[0];
      if (!previous) throw new NotFoundException('Repasse não encontrado.');
      if (input.effectiveFrom < previous.effective_from || (previous.effective_to && input.effectiveFrom > previous.effective_to))
        throw new BadRequestException('A nova vigência precisa permanecer dentro do período já configurado.');

      const destinationId = await this.destination(client, input.name);
      const effectiveTo = Object.prototype.hasOwnProperty.call(input, 'effectiveTo')
        ? input.effectiveTo ?? null
        : previous.effective_to;
      await this.assertNoOverlap(client, destinationId, input.effectiveFrom, input.effectiveTo ?? null, id);
      const sameDestination = destinationId === previous.destination_id;
      if (input.effectiveFrom > previous.effective_from) {
        const priorEnd = this.previousPeriod(input.effectiveFrom);
        await client.query('UPDATE financial_repasses SET effective_to=$2,updated_at=NOW() WHERE id=$1', [id, priorEnd]);
        const result = await client.query(
          `INSERT INTO financial_repasses(destination_id,value_type,value,effective_from,effective_to)
           VALUES($1,$2,$3,$4,$5) RETURNING id,destination_id AS "destinationId",value_type AS "valueType",value::text,effective_from AS "effectiveFrom",effective_to AS "effectiveTo"`,
          [destinationId, input.valueType, input.value, input.effectiveFrom, effectiveTo],
        );
        return { ...result.rows[0], name: input.name.trim(), historyPreserved: true };
      }

      const result = await client.query(
        `UPDATE financial_repasses SET destination_id=$2,value_type=$3,value=$4,effective_to=$5,updated_at=NOW()
         WHERE id=$1 RETURNING id,destination_id AS "destinationId",value_type AS "valueType",value::text,effective_from AS "effectiveFrom",effective_to AS "effectiveTo"`,
        [id, destinationId, input.valueType, input.value, effectiveTo],
      );
      if (!sameDestination && previous.effective_from < currentPeriod)
        throw new BadRequestException('Para renomear um repasse com histórico, crie uma nova vigência a partir deste mês.');
      return { ...result.rows[0], name: input.name.trim() };
    });
  }

  async remove(id: string) {
    return this.database.transaction(async (client) => {
      const result = await client.query<RepasseRow>(
        `SELECT id,destination_id,'' AS name,value_type,value::text,effective_from,effective_to
         FROM financial_repasses WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('Repasse não encontrado.');
      const currentPeriod = this.currentPeriod();
      if (row.effective_to && row.effective_to < currentPeriod)
        throw new BadRequestException('Esta regra pertence somente ao histórico. Para mudá-la, ajuste o repasse naquela competência.');
      if (row.effective_from < currentPeriod) {
        await client.query('UPDATE financial_repasses SET effective_to=$2,updated_at=NOW() WHERE id=$1', [id, this.previousPeriod(currentPeriod)]);
      } else {
        await client.query('UPDATE financial_repasses SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1', [id]);
      }
      return { deleted: true };
    });
  }

  private validate(input: RepasseInputDto) {
    if (!input.name.trim()) throw new BadRequestException('Informe o nome do repasse.');
    if (input.valueType === 'percentage' && Number(input.value) > 100)
      throw new BadRequestException('O percentual precisa estar entre 0 e 100.');
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom)
      throw new BadRequestException('O fim da vigência não pode ser anterior ao início.');
  }

  private async destination(client: import('pg').PoolClient, name: string) {
    const existing = await client.query<{ id: string }>('SELECT id FROM forecast_destinations WHERE lower(name)=lower($1) LIMIT 1', [name.trim()]);
    if (existing.rows[0]) {
      await client.query('UPDATE forecast_destinations SET active=TRUE WHERE id=$1', [existing.rows[0].id]);
      return existing.rows[0].id;
    }
    const created = await client.query<{ id: string }>('INSERT INTO forecast_destinations(name) VALUES($1) RETURNING id', [name.trim()]);
    return created.rows[0].id;
  }

  private async assertNoOverlap(client: import('pg').PoolClient, destinationId: string, from: string, to: string | null, excludingId?: string) {
    const result = await client.query<{ effective_from: string; effective_to: string | null }>(
      `SELECT effective_from,effective_to FROM financial_repasses WHERE destination_id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id<>$2)`,
      [destinationId, excludingId ?? null],
    );
    const newEnd = to ?? '9999-12';
    if (result.rows.some((row) => from <= (row.effective_to ?? '9999-12') && newEnd >= row.effective_from))
      throw new ConflictException('Já existe uma vigência sobreposta para este nome de repasse.');
  }

  private currentPeriod() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  private previousPeriod(period: string) {
    const [year, month] = period.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 2, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
