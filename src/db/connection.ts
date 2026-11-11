import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

export interface DatabaseClient {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  release(): void;
}

export interface DatabasePool {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  getClient(): Promise<DatabaseClient>;
  transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
  healthCheck(): Promise<boolean>;
}

class PostgresDatabasePool implements DatabasePool {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes('supabase.co') ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      console.error('CRITICAL: Unexpected error on idle database client', err);
    });
  }

  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await this.pool.query(text, params);
    return { rows: res.rows, rowCount: res.rowCount };
  }

  async getClient(): Promise<DatabaseClient> {
    const client = await this.pool.connect();
    return {
      query: async <T = any>(text: string, params?: any[]) => {
        const res = await client.query(text, params);
        return { rows: res.rows, rowCount: res.rowCount };
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
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as alive');
      return res.rows[0]?.alive === 1;
    } catch (err) {
      return false;
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

// Single instance for production/dev
export const db: DatabasePool = new PostgresDatabasePool(config.DATABASE_URL);
