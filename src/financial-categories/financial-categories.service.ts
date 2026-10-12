import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { rethrowDatabaseError } from '../common/database-errors.js';
import { CreateFinancialCategoryDto, UpdateFinancialCategoryDto } from './dto/financial-category.dto.js';

@Injectable()
export class FinancialCategoriesService {
  constructor(private readonly database: DatabaseService) {}

  async findAll(active?: boolean, nature?: 'income' | 'expense') {
    const result = await this.database.query(
      `SELECT c.id,c.name,c.nature,c.active,c.destination_id AS "destinationId",d.name AS "destinationName",
         c.parent_category_id AS "parentCategoryId",parent.name AS "parentCategoryName"
       FROM financial_categories c JOIN forecast_destinations d ON d.id=c.destination_id
       LEFT JOIN financial_categories parent ON parent.id=c.parent_category_id
       WHERE ($1::boolean IS NULL OR c.active=$1) AND ($2::text IS NULL OR c.nature=$2)
       ORDER BY c.active DESC,c.nature,d.name,parent.name NULLS FIRST,c.name`,
      [active ?? null, nature ?? null],
    );
    return result.rows;
  }

  async create(input: CreateFinancialCategoryDto) {
    if (!input.name.trim()) throw new BadRequestException('O nome da categoria é obrigatório.');
    try {
      let destinationId = input.destinationId;
      if (input.parentCategoryId) {
        const parent = await this.database.query<{ destination_id: string; nature: string; parent_category_id: string | null }>(
          'SELECT destination_id,nature,parent_category_id FROM financial_categories WHERE id=$1 AND active=TRUE', [input.parentCategoryId],
        );
        if (!parent.rows[0] || parent.rows[0].nature !== input.nature || parent.rows[0].parent_category_id)
          throw new BadRequestException('A subcategoria deve pertencer a uma categoria principal ativa da mesma natureza.');
        if (destinationId && destinationId !== parent.rows[0].destination_id)
          throw new BadRequestException('A subcategoria herda o repasse da categoria principal.');
        destinationId = parent.rows[0].destination_id;
      }
      destinationId ??= (await this.database.query<{ id: string }>("SELECT id FROM forecast_destinations WHERE name='Outras' AND active=TRUE LIMIT 1")).rows[0]?.id;
      const destination = await this.database.query('SELECT id FROM forecast_destinations WHERE id=$1 AND active=TRUE', [destinationId]);
      if (!destination.rowCount) throw new BadRequestException('Selecione um repasse ativo para a categoria.');
      const result = await this.database.query(
        `INSERT INTO financial_categories(name,nature,destination_id,parent_category_id) VALUES($1,$2,$3,$4)
         RETURNING id,name,nature,active,destination_id AS "destinationId",parent_category_id AS "parentCategoryId"`,
        [input.name.trim(), input.nature, destinationId, input.parentCategoryId ?? null],
      );
      return this.withNames(result.rows[0]);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      rethrowDatabaseError(error);
    }
  }

  async update(id: string, input: UpdateFinancialCategoryDto) {
    if (input.name !== undefined && !input.name.trim()) throw new BadRequestException('O nome da categoria é obrigatório.');
    try {
      const current = await this.database.query<{ nature: string; destination_id: string; parent_category_id: string | null }>(
        'SELECT nature,destination_id,parent_category_id FROM financial_categories WHERE id=$1', [id],
      );
      if (!current.rows[0]) throw new NotFoundException('Categoria financeira não encontrada.');
      const old = current.rows[0];
      const nature = input.nature ?? old.nature;
      const parentId = input.parentCategoryId === undefined ? old.parent_category_id : input.parentCategoryId;
      let destinationId = input.destinationId ?? old.destination_id;
      if (parentId) {
        if (parentId === id) throw new BadRequestException('Uma categoria não pode ser subcategoria dela mesma.');
        if (!old.parent_category_id) {
          const children = await this.database.query('SELECT 1 FROM financial_categories WHERE parent_category_id=$1 LIMIT 1', [id]);
          if (children.rowCount) throw new BadRequestException('Mova as subcategorias antes de transformar esta categoria em subcategoria.');
        }
        const parent = await this.database.query<{ nature: string; destination_id: string; parent_category_id: string | null }>(
          'SELECT nature,destination_id,parent_category_id FROM financial_categories WHERE id=$1 AND active=TRUE', [parentId],
        );
        if (!parent.rows[0] || parent.rows[0].parent_category_id || parent.rows[0].nature !== nature)
          throw new BadRequestException('Escolha uma categoria principal ativa da mesma natureza.');
        if (input.destinationId && input.destinationId !== parent.rows[0].destination_id)
          throw new BadRequestException('A subcategoria herda o repasse da categoria principal.');
        destinationId = parent.rows[0].destination_id;
      }
      if (nature !== old.nature) {
        const used = await this.database.query('SELECT 1 FROM cash_book_entries WHERE category_id=$1 LIMIT 1', [id]);
        if (used.rowCount) throw new BadRequestException('Não é possível alterar a natureza de uma categoria já utilizada.');
        const children = await this.database.query('SELECT 1 FROM financial_categories WHERE parent_category_id=$1 LIMIT 1', [id]);
        if (children.rowCount) throw new BadRequestException('Altere a natureza das subcategorias antes de continuar.');
      }
      const destination = await this.database.query('SELECT id FROM forecast_destinations WHERE id=$1 AND active=TRUE', [destinationId]);
      if (!destination.rowCount) throw new BadRequestException('Selecione um repasse ativo para a categoria.');
      const result = await this.database.transaction(async (client) => {
        const updated = await client.query(
          `UPDATE financial_categories SET name=COALESCE($2,name),nature=$3,active=COALESCE($4,active),destination_id=$5,parent_category_id=$6,updated_at=NOW()
           WHERE id=$1 RETURNING id,name,nature,active,destination_id AS "destinationId",parent_category_id AS "parentCategoryId"`,
          [id, input.name?.trim() ?? null, nature, input.active ?? null, destinationId, parentId],
        );
        if (!parentId) {
          await client.query('UPDATE financial_categories SET destination_id=$2,updated_at=NOW() WHERE parent_category_id=$1', [id, destinationId]);
          if (input.active === false) await client.query('UPDATE financial_categories SET active=FALSE,updated_at=NOW() WHERE parent_category_id=$1', [id]);
        }
        return updated.rows[0];
      });
      return this.withNames(result);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      rethrowDatabaseError(error);
    }
  }

  private async withNames(row: Record<string, unknown>) {
    const names = await this.database.query<{ destination: string; parent: string | null }>(
      'SELECT d.name AS destination,p.name AS parent FROM forecast_destinations d LEFT JOIN financial_categories p ON p.id=$2 WHERE d.id=$1',
      [row.destinationId, row.parentCategoryId ?? null],
    );
    return { ...row, destinationName: names.rows[0]?.destination, parentCategoryName: names.rows[0]?.parent };
  }
}
