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
      if (input.valueType === 'percentage') await this.rebalancePercentages(client, input.effectiveFrom, destinationId, this.toBasisPoints(input.value), input.effectiveTo ?? null);
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
        if (input.valueType === 'percentage') await this.rebalancePercentages(client, input.effectiveFrom, destinationId, this.toBasisPoints(input.value), effectiveTo);
        else if (previous.value_type === 'percentage') await this.rebalanceExistingPercentages(client, input.effectiveFrom, destinationId);
        if (previous.destination_id !== destinationId) await this.rebalanceExistingPercentages(client, input.effectiveFrom, previous.destination_id);
        return { ...result.rows[0], name: input.name.trim(), historyPreserved: true };
      }

      const result = await client.query(
        `UPDATE financial_repasses SET destination_id=$2,value_type=$3,value=$4,effective_to=$5,updated_at=NOW()
         WHERE id=$1 RETURNING id,destination_id AS "destinationId",value_type AS "valueType",value::text,effective_from AS "effectiveFrom",effective_to AS "effectiveTo"`,
        [id, destinationId, input.valueType, input.value, effectiveTo],
      );
      if (input.valueType === 'percentage') await this.rebalancePercentages(client, input.effectiveFrom, destinationId, this.toBasisPoints(input.value), effectiveTo);
      else if (previous.value_type === 'percentage') await this.rebalanceExistingPercentages(client, input.effectiveFrom, destinationId);
      if (previous.destination_id !== destinationId) await this.rebalanceExistingPercentages(client, input.effectiveFrom, previous.destination_id);
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
      await this.rebalanceExistingPercentages(client, row.effective_from > currentPeriod ? row.effective_from : currentPeriod, row.destination_id);
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

  private toBasisPoints(value: string) {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  }

  private async rebalancePercentages(client: import('pg').PoolClient, period: string, selectedId: string, selectedValue: bigint, through: string | null = null) {
    const result = await client.query<{ id: string; destination_id: string; value: string; effective_from: string; effective_to: string | null }>(
      `SELECT id,destination_id,value::text,effective_from,effective_to FROM financial_repasses
       WHERE deleted_at IS NULL AND value_type='percentage' AND effective_from<=$1 AND (effective_to IS NULL OR effective_to>=$1)
       ORDER BY destination_id,effective_from DESC FOR UPDATE`, [period],
    );
    const rowsByDestination = new Map<string, typeof result.rows[number]>();
    for (const row of result.rows) if (!rowsByDestination.has(row.destination_id)) rowsByDestination.set(row.destination_id, row);
    const rows = [...rowsByDestination.values()];
    const target = rows.find((row) => row.destination_id === selectedId);
    if (!target) return;
    const peers = rows.filter((row) => row.destination_id !== selectedId);
    if (!peers.length) {
      await client.query('UPDATE financial_repasses SET value=100,updated_at=NOW() WHERE id=$1', [target.id]);
      return;
    }
    const available = 10000n - selectedValue;
    const peerTotal = peers.reduce((sum, row) => sum + this.toBasisPoints(row.value), 0n);
    const allocation = peers.map((row) => {
      const oldValue = this.toBasisPoints(row.value);
      const share = peerTotal > 0n ? oldValue * available / peerTotal : peers.length ? available / BigInt(peers.length) : 0n;
      return { row, value: share };
    });
    if (allocation.length) {
      const assigned = allocation.reduce((sum, item) => sum + item.value, 0n);
      allocation[allocation.length - 1].value += available - assigned;
    }
    for (const { row, value } of allocation) {
      const formatted = `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
      const intervalEnd = through && (!row.effective_to || row.effective_to > through) ? through : row.effective_to;
      if (row.effective_from < period) {
        await client.query('UPDATE financial_repasses SET effective_to=$2,updated_at=NOW() WHERE id=$1', [row.id, this.previousPeriod(period)]);
        await client.query('INSERT INTO financial_repasses(destination_id,value_type,value,effective_from,effective_to) VALUES($1,\'percentage\',$2,$3,$4)', [row.destination_id, formatted, period, intervalEnd]);
        if (through && (!row.effective_to || row.effective_to > through)) {
          await client.query('INSERT INTO financial_repasses(destination_id,value_type,value,effective_from,effective_to) VALUES($1,\'percentage\',$2,$3,$4)', [row.destination_id, row.value, this.nextPeriod(through), row.effective_to]);
        }
      } else {
        await client.query('UPDATE financial_repasses SET value=$2,effective_to=COALESCE($3,effective_to),updated_at=NOW() WHERE id=$1', [row.id, formatted, intervalEnd]);
        if (through && (!row.effective_to || row.effective_to > through)) {
          await client.query('INSERT INTO financial_repasses(destination_id,value_type,value,effective_from,effective_to) VALUES($1,\'percentage\',$2,$3,$4)', [row.destination_id, row.value, this.nextPeriod(through), row.effective_to]);
        }
      }
    }
  }

  private async rebalanceExistingPercentages(client: import('pg').PoolClient, period: string, destinationId: string) {
    const active = await client.query<{ destination_id: string; value: string }>(
      `SELECT destination_id,value::text FROM financial_repasses WHERE destination_id=$1 AND value_type='percentage' AND deleted_at IS NULL
       AND effective_from<=$2 AND (effective_to IS NULL OR effective_to>=$2) ORDER BY effective_from DESC LIMIT 1`, [destinationId, period],
    );
    let selected = active.rows[0];
    if (!selected) selected = (await client.query<{ destination_id: string; value: string }>(
      `SELECT destination_id,value::text FROM financial_repasses WHERE value_type='percentage' AND deleted_at IS NULL
       AND effective_from<=$1 AND (effective_to IS NULL OR effective_to>=$1) ORDER BY destination_id,effective_from DESC LIMIT 1`, [period],
    )).rows[0];
    if (selected) await this.rebalancePercentages(client, period, selected.destination_id, this.toBasisPoints(selected.value));
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
  private nextPeriod(period: string) {
    const [year, month] = period.split('-').map(Number);
    const date = new Date(Date.UTC(year, month, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
