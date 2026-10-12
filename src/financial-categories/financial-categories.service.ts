import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { rethrowDatabaseError } from '../common/database-errors.js';
import { CreateFinancialCategoryDto, UpdateFinancialCategoryDto } from './dto/financial-category.dto.js';

@Injectable()
export class FinancialCategoriesService {
  constructor(private readonly database: DatabaseService) {}

  async findAll(active?: boolean, nature?: 'income' | 'expense') {
    const result = await this.database.query(
      `SELECT c.id, c.name, c.nature, c.active, c.destination_id AS "destinationId",
         d.name AS "destinationName"
       FROM financial_categories c JOIN forecast_destinations d ON d.id = c.destination_id
       WHERE ($1::boolean IS NULL OR c.active = $1) AND ($2::text IS NULL OR c.nature = $2)
       ORDER BY c.active DESC, c.nature, d.name, c.name`,
      [active ?? null, nature ?? null],
    );
    return result.rows;
  }

  async create(input: CreateFinancialCategoryDto) {
    if (!input.name.trim()) throw new BadRequestException('O nome da categoria é obrigatório.');
    try {
      const destinationId = input.destinationId ?? (await this.database.query<{ id: string }>(
        `SELECT id FROM forecast_destinations WHERE name='Outras' AND active=TRUE LIMIT 1`,
      )).rows[0]?.id;
      const destination = await this.database.query(
        'SELECT id FROM forecast_destinations WHERE id=$1 AND active=TRUE',
        [destinationId],
      );
      if (!destination.rowCount) throw new BadRequestException('Selecione um repasse ativo para a categoria.');
      const result = await this.database.query(
        `INSERT INTO financial_categories (name, nature, destination_id) VALUES ($1, $2, $3)
         RETURNING id, name, nature, active, destination_id AS "destinationId"`,
        [input.name.trim(), input.nature, destinationId],
      );
      return { ...result.rows[0], destinationName: (await this.database.query<{ name: string }>('SELECT name FROM forecast_destinations WHERE id=$1', [destinationId])).rows[0]?.name };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      rethrowDatabaseError(error);
    }
  }

  async update(id: string, input: UpdateFinancialCategoryDto) {
    if (input.name !== undefined && !input.name.trim()) throw new BadRequestException('O nome da categoria é obrigatório.');
    if (input.nature) {
      const current = await this.database.query<{ nature: string }>('SELECT nature FROM financial_categories WHERE id = $1', [id]);
      if (!current.rows[0]) throw new NotFoundException('Categoria financeira não encontrada.');
      if (current.rows[0].nature !== input.nature) {
        const used = await this.database.query('SELECT 1 FROM cash_book_entries WHERE category_id = $1 LIMIT 1', [id]);
        if (used.rowCount) throw new BadRequestException('Não é possível alterar a natureza de uma categoria já utilizada.');
      }
    }
    if (input.destinationId) {
      const destination = await this.database.query(
        'SELECT id FROM forecast_destinations WHERE id=$1 AND active=TRUE',
        [input.destinationId],
      );
      if (!destination.rowCount) throw new BadRequestException('Selecione um repasse ativo para a categoria.');
    }
    try {
      const result = await this.database.query(
        `UPDATE financial_categories SET name = COALESCE($2, name), nature = COALESCE($3, nature),
         active = COALESCE($4, active), destination_id = COALESCE($5, destination_id), updated_at = NOW() WHERE id = $1
         RETURNING id, name, nature, active, destination_id AS "destinationId"`,
        [id, input.name?.trim() ?? null, input.nature ?? null, input.active ?? null, input.destinationId ?? null],
      );
      if (!result.rowCount) throw new NotFoundException('Categoria financeira não encontrada.');
      const destination = await this.database.query<{ name: string }>('SELECT name FROM forecast_destinations WHERE id=$1', [result.rows[0].destinationId]);
      return { ...result.rows[0], destinationName: destination.rows[0]?.name };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      rethrowDatabaseError(error);
    }
  }
}
