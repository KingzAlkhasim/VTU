import { JournalEntry, JournalLine } from '../types/ledger.js';
import { DatabaseClient } from '../db/connection.js';

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerValidationError';
  }
}

/**
 * Mathematical Double-Entry Balancing Engine
 * Verifies that sum(Debits) === sum(Credits)
 */
export function validateJournalBalance(lines: JournalLine[]): void {
  if (!lines || lines.length < 2) {
    throw new LedgerValidationError('A journal entry must contain at least two journal lines (debit and credit).');
  }

  let totalDebit = 0n;
  let totalCredit = 0n;

  for (const line of lines) {
    if (line.amountKobo <= 0n) {
      throw new LedgerValidationError(`Journal line amount must be strictly positive (> 0 Kobo). Received: ${line.amountKobo}`);
    }

    if (line.direction === 'DEBIT') {
      totalDebit += line.amountKobo;
    } else if (line.direction === 'CREDIT') {
      totalCredit += line.amountKobo;
    } else {
      throw new LedgerValidationError(`Invalid entry direction: ${line.direction}`);
    }
  }

  if (totalDebit !== totalCredit) {
    throw new LedgerValidationError(
      `Unbalanced journal entry! Total Debit (${totalDebit} Kobo) != Total Credit (${totalCredit} Kobo). Discrepancy: ${totalDebit - totalCredit} Kobo.`
    );
  }
}

export class LedgerService {
  /**
   * Posts an atomic, balanced Journal Entry to the database
   */
  static async postJournalEntry(client: DatabaseClient, entry: JournalEntry): Promise<string> {
    // 1. Enforce mathematical double-entry balance
    validateJournalBalance(entry.lines);

    // 2. Insert master Journal Entry
    const entryRes = await client.query<{ id: string }>(
      `INSERT INTO journal_entries (reference, description, entry_type, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [entry.reference, entry.description, entry.entryType, JSON.stringify(entry.metadata || {})]
    );

    const journalEntryId = entryRes.rows[0].id;

    // 3. Insert each balanced Journal Line
    for (const line of entry.lines) {
      await client.query(
        `INSERT INTO journal_lines (journal_entry_id, account_id, entry_direction, amount_kobo)
         VALUES ($1, $2, $3, $4)`,
        [journalEntryId, line.accountId, line.direction, line.amountKobo.toString()]
      );
    }

    return journalEntryId;
  }

  /**
   * Formats standard account IDs
   */
  static getUserAvailableAccountId(userId: string): string {
    return `2010-USER-AVAILABLE:${userId}`;
  }

  static getUserLockedAccountId(userId: string): string {
    return `2020-USER-LOCKED:${userId}`;
  }

  static getProviderFloatAccountId(providerName: string): string {
    return `1020-PROVIDER-FLOAT:${providerName.toUpperCase()}`;
  }
}
