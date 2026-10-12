import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { rethrowDatabaseError } from '../common/database-errors.js';
import { CreateFinancialCategoryDto, UpdateFinancialCategoryDto } from './dto/financial-category.dto.js';

@Injectable()
export class FinancialCategoriesService {
  constructor(private readonly database: DatabaseService) {}

  async findAll(active?: boolean, nature?: 'income' | 'expense') {
    const result = await this.database.query(
      `SELECT id, name, nature, active FROM financial_categories
       WHERE ($1::boolean IS NULL OR active = $1) AND ($2::text IS NULL OR nature = $2)
       ORDER BY active DESC, nature, name`,
      [active ?? null, nature ?? null],
    );
    return result.rows;
  }

  async create(input: CreateFinancialCategoryDto) {
    if (!input.name.trim()) throw new BadRequestException('O nome da categoria é obrigatório.');
    try {
      const result = await this.database.query(
        `INSERT INTO financial_categories (name, nature) VALUES ($1, $2)
         RETURNING id, name, nature, active`,
        [input.name.trim(), input.nature],
      );
      return result.rows[0];
    } catch (error) {
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
    try {
      const result = await this.database.query(
        `UPDATE financial_categories SET name = COALESCE($2, name), nature = COALESCE($3, nature),
         active = COALESCE($4, active), updated_at = NOW() WHERE id = $1
         RETURNING id, name, nature, active`,
        [id, input.name?.trim() ?? null, input.nature ?? null, input.active ?? null],
      );
      if (!result.rowCount) throw new NotFoundException('Categoria financeira não encontrada.');
      return result.rows[0];
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      rethrowDatabaseError(error);
    }
  }
}
