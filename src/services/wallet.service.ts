import { config } from '../config.js';
import { DatabaseClient } from '../db/connection.js';
import { LedgerService } from './ledger.service.js';
import { WalletBalance } from '../types/ledger.js';

export class InsufficientFundsError extends Error {
  constructor(message = 'Insufficient available wallet balance.') {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export class WalletInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletInvariantError';
  }
}

type BalanceRow = {
  user_id: string;
  available_kobo: string;
  locked_kobo: string;
  currency: string;
  last_journal_entry_id?: string;
  updated_at: string;
};

function assertPositiveAmount(amount: bigint, label = 'amount'): void {
  if (amount <= 0n) throw new WalletInvariantError(`${label} must be greater than zero Kobo.`);
}

function toBalance(row: BalanceRow): WalletBalance {
  return {
    userId: row.user_id,
    availableKobo: BigInt(row.available_kobo),
    lockedKobo: BigInt(row.locked_kobo),
    currency: row.currency,
    lastJournalEntryId: row.last_journal_entry_id,
    updatedAt: new Date(row.updated_at),
  };
}

async function updateWallet(
  client: DatabaseClient,
  userId: string,
  journalEntryId: string,
  sql: string,
  params: unknown[]
): Promise<WalletBalance> {
  const result = await client.query<BalanceRow>(sql, [...params, journalEntryId]);
  const row = result.rows[0];
  if (!row) throw new WalletInvariantError(`Wallet row for user ${userId} was not found or failed its balance constraint.`);
  return toBalance(row);
}

export class WalletService {
  // Every mutating method in this service MUST be called inside db.transaction().
  static async ensureUserWallet(client: DatabaseClient, userId: string, email: string): Promise<void> {
    if (!userId.trim()) throw new WalletInvariantError('userId is required.');

    await client.query(
      `INSERT INTO accounts (id, account_number, name, type, currency, user_id)
       VALUES ($1, $2, $3, 'LIABILITY', 'NGN', $4)
       ON CONFLICT (id) DO NOTHING`,
      [LedgerService.getUserAvailableAccountId(userId), `USER-AVAIL-${userId.slice(0, 8)}`, `User Available Wallet (${email})`, userId]
    );

    await client.query(
      `INSERT INTO accounts (id, account_number, name, type, currency, user_id)
       VALUES ($1, $2, $3, 'LIABILITY', 'NGN', $4)
       ON CONFLICT (id) DO NOTHING`,
      [LedgerService.getUserLockedAccountId(userId), `USER-LOCK-${userId.slice(0, 8)}`, `User Locked Balance (${email})`, userId]
    );

    await client.query(
      `INSERT INTO wallet_balances (user_id, available_kobo, locked_kobo, currency)
       VALUES ($1, 0, 0, 'NGN')
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
  }

  static async getBalance(client: DatabaseClient, userId: string): Promise<WalletBalance> {
    const result = await client.query<BalanceRow>(
      `SELECT user_id, available_kobo, locked_kobo, currency, last_journal_entry_id, updated_at
       FROM wallet_balances WHERE user_id = $1`,
      [userId]
    );

    if (!result.rows[0]) {
      return { userId, availableKobo: 0n, lockedKobo: 0n, currency: 'NGN', updatedAt: new Date() };
    }
    return toBalance(result.rows[0]);
  }

  /**
   * amountKobo is the gross amount charged to the customer.
   * If the gateway deducts feeKobo before settlement:
   * DR gateway asset (gross - fee), DR gateway fee expense (fee),
   * CR customer wallet liability (gross).
   */
  static async creditWalletFromGateway(
    client: DatabaseClient,
    userId: string,
    amountKobo: bigint,
    feeKobo: bigint,
    reference: string,
    metadata?: Record<string, unknown>
  ): Promise<{ journalEntryId: string; balance: WalletBalance }> {
    assertPositiveAmount(amountKobo);
    if (feeKobo < 0n || feeKobo > amountKobo) {
      throw new WalletInvariantError('Gateway fee must be between zero and the gross funding amount.');
    }

    const netSettlement = amountKobo - feeKobo;
    const lines = [
      ...(netSettlement > 0n ? [{ accountId: '1010-GATEWAY-ESCROW', direction: 'DEBIT' as const, amountKobo: netSettlement }] : []),
      ...(feeKobo > 0n ? [{ accountId: '5020-PAYMENT-GATEWAY-FEES', direction: 'DEBIT' as const, amountKobo: feeKobo }] : []),
      { accountId: LedgerService.getUserAvailableAccountId(userId), direction: 'CREDIT' as const, amountKobo },
    ];

    const journalEntryId = await LedgerService.postJournalEntry(client, {
      reference,
      description: `Wallet funding via gateway ref: ${reference}`,
      entryType: 'WALLET_FUNDING',
      metadata,
      lines,
    });

    const balance = await updateWallet(
      client, userId, journalEntryId,
      `UPDATE wallet_balances
       SET available_kobo = available_kobo + $2,
           last_journal_entry_id = $3, updated_at = NOW()
       WHERE user_id = $1
       RETURNING user_id, available_kobo, locked_kobo, currency, last_journal_entry_id, updated_at`,
      [userId, amountKobo.toString()]
    );
    return { journalEntryId, balance };
  }

  static async mockFundWallet(
    client: DatabaseClient,
    userId: string,
    amountKobo: bigint,
    reference: string
  ): Promise<{ journalEntryId: string; balance: WalletBalance }> {
    if (config.APP_ENV !== 'sandbox') {
      throw new Error('SECURITY VIOLATION: Mock wallet funding is permitted only in APP_ENV=sandbox.');
    }
    assertPositiveAmount(amountKobo);

    const journalEntryId = await LedgerService.postJournalEntry(client, {
      reference,
      description: `Mock sandbox funding ref: ${reference}`,
      entryType: 'MOCK_SANDBOX_FUNDING',
      metadata: { sandbox: true },
      lines: [
        { accountId: '2090-SANDBOX-FUNDING', direction: 'DEBIT', amountKobo },
        { accountId: LedgerService.getUserAvailableAccountId(userId), direction: 'CREDIT', amountKobo },
      ],
    });

    const balance = await updateWallet(
      client, userId, journalEntryId,
      `UPDATE wallet_balances
       SET available_kobo = available_kobo + $2,
           last_journal_entry_id = $3, updated_at = NOW()
       WHERE user_id = $1
       RETURNING user_id, available_kobo, locked_kobo, currency, last_journal_entry_id, updated_at`,
      [userId, amountKobo.toString()]
    );
    return { journalEntryId, balance };
  }

  static async holdFundsForPurchase(
    client: DatabaseClient,
    userId: string,
    amountKobo: bigint,
    reference: string
  ): Promise<{ journalEntryId: string }> {
    assertPositiveAmount(amountKobo);
    const current = await client.query<{ available_kobo: string }>(
      'SELECT available_kobo FROM wallet_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (!current.rows[0] || BigInt(current.rows[0].available_kobo) < amountKobo) {
      throw new InsufficientFundsError(
        `Insufficient available funds. Required: ${amountKobo} Kobo; available: ${current.rows[0]?.available_kobo ?? '0'} Kobo.`
      );
    }

    const journalEntryId = await LedgerService.postJournalEntry(client, {
      reference: `HOLD:${reference}`,
      description: `Hold funds for purchase ref: ${reference}`,
      entryType: 'VTU_PURCHASE_HOLD',
      lines: [
        { accountId: LedgerService.getUserAvailableAccountId(userId), direction: 'DEBIT', amountKobo },
        { accountId: LedgerService.getUserLockedAccountId(userId), direction: 'CREDIT', amountKobo },
      ],
    });

    const updated = await client.query(
      `UPDATE wallet_balances
       SET available_kobo = available_kobo - $2, locked_kobo = locked_kobo + $2,
           last_journal_entry_id = $3, updated_at = NOW()
       WHERE user_id = $1 AND available_kobo >= $2`,
      [userId, amountKobo.toString(), journalEntryId]
    );
    if (updated.rowCount !== 1) throw new WalletInvariantError('Wallet changed while holding funds; transaction rolled back.');
    return { journalEntryId };
  }

  /**
   * Gross accounting model:
   * DR customer locked liability / CR VTU sales revenue (gross);
   * DR cost of goods sold / CR provider float asset (wholesale cost).
   * Margin is the resulting revenue less COGS; it is not posted a second time.
   */
  static async settlePurchaseSuccess(
    client: DatabaseClient,
    userId: string,
    amountKobo: bigint,
    costKobo: bigint,
    providerName: string,
    reference: string
  ): Promise<{ journalEntryId: string }> {
    assertPositiveAmount(amountKobo, 'sale amount');
    if (costKobo < 0n) throw new WalletInvariantError('Provider cost cannot be negative.');

    const current = await client.query<{ locked_kobo: string }>(
      'SELECT locked_kobo FROM wallet_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (!current.rows[0] || BigInt(current.rows[0].locked_kobo) < amountKobo) {
      throw new WalletInvariantError('Locked wallet balance is insufficient to settle this purchase.');
    }

    const lines = [
      { accountId: LedgerService.getUserLockedAccountId(userId), direction: 'DEBIT' as const, amountKobo },
      { accountId: '4010-VTU-COMMISSION', direction: 'CREDIT' as const, amountKobo },
      ...(costKobo > 0n ? [
        { accountId: '5010-VTU-COST-OF-GOODS', direction: 'DEBIT' as const, amountKobo: costKobo },
        { accountId: LedgerService.getProviderFloatAccountId(providerName), direction: 'CREDIT' as const, amountKobo: costKobo },
      ] : []),
    ];

    const journalEntryId = await LedgerService.postJournalEntry(client, {
      reference: `SETTLE:${reference}`,
      description: `Successful VTU sale and provider cost for ref: ${reference}`,
      entryType: 'VTU_PURCHASE_SETTLE',
      lines,
    });

    const updated = await client.query(
      `UPDATE wallet_balances
       SET locked_kobo = locked_kobo - $2, last_journal_entry_id = $3, updated_at = NOW()
       WHERE user_id = $1 AND locked_kobo >= $2`,
      [userId, amountKobo.toString(), journalEntryId]
    );
    if (updated.rowCount !== 1) throw new WalletInvariantError('Locked wallet balance changed during settlement.');
    return { journalEntryId };
  }

  static async releaseHeldFundsOnFailure(
    client: DatabaseClient,
    userId: string,
    amountKobo: bigint,
    reference: string,
    reason: string
  ): Promise<{ journalEntryId: string }> {
    assertPositiveAmount(amountKobo);
    const current = await client.query<{ locked_kobo: string }>(
      'SELECT locked_kobo FROM wallet_balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (!current.rows[0] || BigInt(current.rows[0].locked_kobo) < amountKobo) {
      throw new WalletInvariantError('Locked wallet balance is insufficient to release this hold.');
    }

    const journalEntryId = await LedgerService.postJournalEntry(client, {
      reference: `RELEASE:${reference}`,
      description: `Release hold on failed VTU ref: ${reference}. Reason: ${reason}`,
      entryType: 'VTU_PURCHASE_RELEASE',
      metadata: { reason },
      lines: [
        { accountId: LedgerService.getUserLockedAccountId(userId), direction: 'DEBIT', amountKobo },
        { accountId: LedgerService.getUserAvailableAccountId(userId), direction: 'CREDIT', amountKobo },
      ],
    });

    const updated = await client.query(
      `UPDATE wallet_balances
       SET locked_kobo = locked_kobo - $2, available_kobo = available_kobo + $2,
           last_journal_entry_id = $3, updated_at = NOW()
       WHERE user_id = $1 AND locked_kobo >= $2`,
      [userId, amountKobo.toString(), journalEntryId]
    );
    if (updated.rowCount !== 1) throw new WalletInvariantError('Wallet changed while releasing funds.');
    return { journalEntryId };
  }
}
