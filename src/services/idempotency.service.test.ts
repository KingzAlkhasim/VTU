import { describe, expect, it } from 'vitest';
import { IdempotencyService } from './idempotency.service.js';

describe('IdempotencyService.generateFingerprint', () => {
  it('produces the same fingerprint regardless of object key order', () => {
    const first = IdempotencyService.generateFingerprint('post', '/wallet/fund', {
      amount: 5000,
      metadata: { channel: 'card', currency: 'NGN' },
    });
    const second = IdempotencyService.generateFingerprint('POST', '/wallet/fund', {
      metadata: { currency: 'NGN', channel: 'card' },
      amount: 5000,
    });
    expect(first).toBe(second);
  });

  it('changes the fingerprint when request values change', () => {
    const first = IdempotencyService.generateFingerprint('POST', '/wallet/fund', { amount: 5000 });
    const second = IdempotencyService.generateFingerprint('POST', '/wallet/fund', { amount: 5001 });
    expect(first).not.toBe(second);
  });
});
