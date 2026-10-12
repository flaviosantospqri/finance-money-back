import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from 'pg';
import { initialCashBookSchema } from './migrations/001-cash-book.js';
import { financialForecastsSchema } from './migrations/002-financial-forecasts.js';
import { investmentsSchema } from './migrations/003-investments.js';
import { accountInstitutionSchema } from './migrations/004-account-institution.js';
import { financialRepassesSchema } from './migrations/005-financial-repasses.js';
import { categoryRepasseSchema } from './migrations/006-category-repasse.js';
import { cashBookEntryOrderSchema } from './migrations/007-cash-book-entry-order.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL');
    if (!connectionString) throw new Error('DATABASE_URL must be configured.');
    const secureConnectionString = connectionString.replace(
      /([?&])sslmode=require(?=&|$)/,
      '$1sslmode=verify-full',
    );
    this.pool = new Pool({
      connectionString: secureConnectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  async onModuleInit() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'fllatech-money-migrations',
      ]);
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
      );
      const applied = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        ['001-cash-book'],
      );
      if (applied.rowCount === 0) {
        await client.query(initialCashBookSchema);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          ['001-cash-book'],
        );
        this.logger.log('Applied database migration 001-cash-book.');
      }
      const forecastsApplied = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        ['002-financial-forecasts'],
      );
      if (forecastsApplied.rowCount === 0) {
        await client.query(financialForecastsSchema);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          ['002-financial-forecasts'],
        );
        this.logger.log('Applied database migration 002-financial-forecasts.');
      }
      const investmentsApplied = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        ['003-investments'],
      );
      if (investmentsApplied.rowCount === 0) {
        await client.query(investmentsSchema);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          ['003-investments'],
        );
        this.logger.log('Applied database migration 003-investments.');
      }
      const accountInstitutionApplied = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        ['004-account-institution'],
      );
      if (accountInstitutionApplied.rowCount === 0) {
        await client.query(accountInstitutionSchema);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          ['004-account-institution'],
        );
        this.logger.log('Applied database migration 004-account-institution.');
      }
      const financialRepassesApplied = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        ['005-financial-repasses'],
      );
      if (financialRepassesApplied.rowCount === 0) {
        await client.query(financialRepassesSchema);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          ['005-financial-repasses'],
        );
        this.logger.log('Applied database migration 005-financial-repasses.');
      }
      const categoryRepasseApplied = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        ['006-category-repasse'],
      );
      if (categoryRepasseApplied.rowCount === 0) {
        await client.query(categoryRepasseSchema);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          ['006-category-repasse'],
        );
        this.logger.log('Applied database migration 006-category-repasse.');
      }
      const cashBookOrderApplied = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        ['007-cash-book-entry-order'],
      );
      if (cashBookOrderApplied.rowCount === 0) {
        await client.query(cashBookEntryOrderSchema);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          ['007-cash-book-entry-order'],
        );
        this.logger.log('Applied database migration 007-cash-book-entry-order.');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(sql, values);
  }

  async transaction<Result>(
    operation: (client: PoolClient) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
