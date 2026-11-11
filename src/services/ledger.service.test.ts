import { describe, expect, it } from 'vitest';
import { LedgerValidationError, validateJournalBalance } from './ledger.service.js';

describe('validateJournalBalance', () => {
  it('accepts a balanced two-line journal', () => {
    expect(() => validateJournalBalance([
      { accountId: 'asset', direction: 'DEBIT', amountKobo: 5000n },
      { accountId: 'liability', direction: 'CREDIT', amountKobo: 5000n },
    ])).not.toThrow();
  });

  it('rejects an unbalanced journal', () => {
    expect(() => validateJournalBalance([
      { accountId: 'asset', direction: 'DEBIT', amountKobo: 5000n },
      { accountId: 'liability', direction: 'CREDIT', amountKobo: 4999n },
    ])).toThrow(LedgerValidationError);
  });

  it('rejects zero and negative amounts', () => {
    expect(() => validateJournalBalance([
      { accountId: 'asset', direction: 'DEBIT', amountKobo: 0n },
      { accountId: 'liability', direction: 'CREDIT', amountKobo: 0n },
    ])).toThrow(LedgerValidationError);
  });

  it('requires at least two journal lines', () => {
    expect(() => validateJournalBalance([
      { accountId: 'asset', direction: 'DEBIT', amountKobo: 1n },
    ])).toThrow(LedgerValidationError);
  });
});
