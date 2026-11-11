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

export interface CachedResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: any;
}

export class IdempotencyService {
  /**
   * Generates a deterministic SHA-256 fingerprint from method, path, and canonical JSON body
   */
  static generateFingerprint(method: string, path: string, body: any): string {
    const canonicalBody = body ? JSON.stringify(body, Object.keys(body).sort()) : '';
    const raw = `${method.toUpperCase()}:${path}:${canonicalBody}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Tries to acquire an idempotency lock.
   * If a previous request is resolved, returns its cached response.
   * If currently processing, throws IdempotencyProcessingError.
   * If reused with different body, throws IdempotencyConflictError.
   */
  static async lockOrRetrieve(
    client: DatabaseClient,
    key: string,
    userId: string,
    fingerprint: string,
    ttlMinutes: number = 10
  ): Promise<{ acquired: boolean; cachedResponse?: CachedResponse }> {
    const existing = await client.query<{
      key: string;
      status: string;
      request_fingerprint: string;
      response_code: number;
      response_headers: any;
      response_body: any;
      locked_at: string;
    }>(
      `SELECT key, status, request_fingerprint, response_code, response_headers, response_body, locked_at
       FROM idempotency_records
       WHERE user_id = $1 AND key = $2`,
      [userId, key]
    );

    if (existing.rows.length > 0) {
      const record = existing.rows[0];

      // Reused key with different payload
      if (record.request_fingerprint !== fingerprint) {
        throw new IdempotencyConflictError(
          `Idempotency-Key '${key}' was previously used with a different request payload.`
        );
      }

      // Already completed -> return stored result
      if (record.status === 'RESOLVED') {
        return {
          acquired: false,
          cachedResponse: {
            statusCode: record.response_code,
            headers: record.response_headers,
            body: record.response_body,
          },
        };
      }

      // If processing but lock is stale (> 60s), allow reclaim
      const lockAgeSeconds = (Date.now() - new Date(record.locked_at).getTime()) / 1000;
      if (record.status === 'PROCESSING' && lockAgeSeconds < 60) {
        throw new IdempotencyProcessingError(
          `A transaction with key '${key}' is currently being processed. Please wait.`
        );
      }
    }

    // Insert or reclaim lock
    await client.query(
      `INSERT INTO idempotency_records (key, user_id, request_fingerprint, status, locked_at, expires_at)
       VALUES ($1, $2, $3, 'PROCESSING', NOW(), NOW() + ($4 || ' minutes')::interval)
       ON CONFLICT (user_id, key) DO UPDATE
       SET status = 'PROCESSING',
           request_fingerprint = $3,
           locked_at = NOW(),
           expires_at = NOW() + ($4 || ' minutes')::interval`,
      [key, userId, fingerprint, ttlMinutes.toString()]
    );

    return { acquired: true };
  }

  /**
   * Resolves the idempotency record with the response payload
   */
  static async resolve(
    client: DatabaseClient,
    key: string,
    userId: string,
    statusCode: number,
    responseBody: any,
    responseHeaders?: Record<string, string>
  ): Promise<void> {
    await client.query(
      `UPDATE idempotency_records
       SET status = 'RESOLVED',
           response_code = $3,
           response_body = $4,
           response_headers = $5
       WHERE user_id = $1 AND key = $2`,
      [userId, key, statusCode, JSON.stringify(responseBody), JSON.stringify(responseHeaders || {})]
    );
  }
}
