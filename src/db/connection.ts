import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number | null;
}

export interface DatabaseClient {
  query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
}

export interface DatabasePool {
  query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  getClient(): Promise<DatabaseClient>;
  transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
  healthCheck(): Promise<boolean>;
}

class PostgresDatabasePool implements DatabasePool {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      // Keep certificate verification enabled for hosted PostgreSQL connections.
      ssl: /supabase\.(co|com)/i.test(connectionString) ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      query_timeout: 20000,
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle database client', err);
    });
  }

  async query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const res = await this.pool.query(text, params);
    return { rows: res.rows as T[], rowCount: res.rowCount };
  }

  async getClient(): Promise<DatabaseClient> {
    const client = await this.pool.connect();
    return {
      query: async <T = unknown>(text: string, params?: unknown[]) => {
        const res = await client.query(text, params);
        return { rows: res.rows as T[], rowCount: res.rowCount };
      },
      release: () => client.release(),
    };
  }

  async transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Database rollback failed; original transaction error follows', rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.pool.query<{ alive: number }>('SELECT 1 AS alive');
      return res.rows[0]?.alive === 1;
    } catch {
      return false;
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export const db: DatabasePool = new PostgresDatabasePool(config.DATABASE_URL);
