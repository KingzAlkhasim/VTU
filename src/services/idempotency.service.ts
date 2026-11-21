import crypto from 'crypto';
import { DatabaseClient } from '../db/connection.js';

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyProcessingError';
  }
}

export class IdempotencyOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyOwnershipError';
  }
}

export interface CachedResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: unknown;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

export class IdempotencyService {
  static generateFingerprint(method: string, path: string, body: unknown): string {
    const canonicalBody = body === undefined ? '' : canonicalize(body);
    return crypto.createHash('sha256')
      .update(`${method.toUpperCase()}: ${path}: ${canonicalBody}`)
      .digest('hex');
  }

  /**
   * Acquires a key exactly once. PROCESSING records are never reclaimed merely
   * because they are old: the original worker may still be running. Stuck keys
   * require an audited recovery procedure after checking transaction/provider state.
   *
   * Commit this acquisition before performing any external provider request.
   */
  static async lockOrRetrieve(
    client: DatabaseClient,
    key: string,
    userId: string,
    fingerprint: string,
    ttlMinutes = 1440
  ): Promise<{ acquired: boolean; lockToken?: string; cachedResponse?: CachedResponse }> {
    if (!key.trim() || key.length > 200) throw new Error('Idempotency key must contain 1–200 characters.');
    if (!userId.trim()) throw new Error('userId is required.');
    if (!/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error('Fingerprint must be a SHA-256 hex digest.');
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 10080) {
      throw new Error('Idempotency TTL must be between 1 and 10080 minutes.');
    }

    const inserted = await client.query<{ lock_token: string }>(
      `INSERT INTO idempotency_records
         (key, user_id, request_fingerprint, status, expires_at)
       VALUES ($1, $2, $3, 'PROCESSING', NOW() + ($4 * INTERVAL '1 minute'))
       ON CONFLICT (user_id, key) DO NOTHING
       RETURNING lock_token`,
      [key, userId, fingerprint, ttlMinutes]
    );

    if (inserted.rows[0]) return { acquired: true, lockToken: inserted.rows[0].lock_token };

    const existing = await client.query<{
      status: string;
      request_fingerprint: string;
      response_code: number | null;
      response_headers: Record<string, string> | null;
      response_body: unknown;
    }>(
      `SELECT status, request_fingerprint, response_code, response_headers, response_body
       FROM idempotency_records
       WHERE user_id = $1 AND key = $2
       FOR UPDATE`,
      [userId, key]
    );

    const record = existing.rows[0];
    if (!record) throw new IdempotencyProcessingError('Could not acquire or inspect the idempotency record; retry safely.');
    if (record.request_fingerprint !== fingerprint) {
      throw new IdempotencyConflictError('This idempotency key was already used with a different request payload.');
    }
    if (record.status === 'RESOLVED' && record.response_code !== null) {
      return {
        acquired: false,
        cachedResponse: {
          statusCode: record.response_code,
          headers: record.response_headers ?? {},
          body: record.response_body,
        },
      };
    }
    throw new IdempotencyProcessingError('A request with this idempotency key is already processing or requires audited recovery.');
  }

  static async resolve(
    client: DatabaseClient,
    key: string,
    userId: string,
    lockToken: string,
    statusCode: number,
    responseBody: unknown,
    responseHeaders: Record<string, string> = {}
  ): Promise<void> {
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      throw new Error('A valid HTTP response status code is required.');
    }

    const result = await client.query(
      `UPDATE idempotency_records
       SET status = 'RESOLVED', response_code = $4, response_body = $5,
           response_headers = $6, updated_at = NOW()
       WHERE user_id = $1 AND key = $2 AND lock_token = $3 AND status = 'PROCESSING'`,
      [userId, key, lockToken, statusCode, JSON.stringify(responseBody), JSON.stringify(responseHeaders)]
    );
    if (result.rowCount !== 1) {
      throw new IdempotencyOwnershipError('Idempotency lock ownership was lost; refusing to resolve another worker’s request.');
    }
  }
}
