import { DatabaseClient } from '../db/connection.js';
import { LedgerService } from './ledger.service.js';
import { WalletBalance } from '../types/ledger.js';

export class InsufficientFundsError extends Error {
  constructor(message: string = 'Insufficient available wallet balance.') {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export class WalletService {
  /**
   * Initializes wallet accounts for a new user if they don't exist
   */
  static async ensureUserWallet(client: DatabaseClient, userId: string, email: string): Promise<void> {
    const availAccountId = LedgerService.getUserAvailableAccountId(userId);
    const lockedAccountId = LedgerService.getUserLockedAccountId(userId);

    // Create available liability account
    await client.query(
      `INSERT INTO accounts (id, account_number, name, type, currency, user_id)
       VALUES ($1, $2, $3, 'LIABILITY', 'NGN', $4)
       ON CONFLICT (id) DO NOTHING`,
      [availAccountId, `USER-AVAIL-${userId.slice(0, 8)}`, `User Available Wallet (${email})`, userId]
    );

    // Create locked liability account
    await client.query(
      `INSERT INTO accounts (id, account_number, name, type, currency, user_id)
       VALUES ($1, $2, $3, 'LIABILITY', 'NGN', $4)
       ON CONFLICT (id) DO NOTHING`,
      [lockedAccountId, `USER-LOCK-${userId.slice(0, 8)}`, `User Locked Balance (${email})`, userId]
    );

    // Initialize balance cache row if not exists
    await client.query(
      `INSERT INTO wallet_balances (user_id, available_kobo, locked_kobo, currency)
       VALUES ($1, 0, 0, 'NGN')
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
  }

  /**
   * Retrieves user's wallet balance
   */
  static async getBalance(client: DatabaseClient, userId: string): Promise<WalletBalance> {
    const res = await client.query<{
      user_id: string;
      available_kobo: string;
      locked_kobo: string;
      currency: string;
      last_journal_entry_id?: string;
      updated_at: string;
    }>(
      `SELECT user_id, available_kobo, locked_kobo, currency, last_journal_entry_id, updated_at
       FROM wallet_balances
       WHERE user_id = $1`,
      [userId]
    );

    if (res.rows.length === 0) {
      return {
        userId,
        availableKobo: 0n,
        lockedKobo: 0n,
        currency: 'NGN',
        updatedAt: new Date(),
      };
    }

    const row = res.rows[0];
    return {
      userId: row.user_id,
      availableKobo: BigInt(row.available_kobo),
      lockedKobo: BigInt(row.locked_kobo),
      currency: row.currency,
      lastJournalEntryId: row.last_journal_entry_id,
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Funds user wallet via Gateway Settlement (Production or Staging)
   */
  static async creditWalletFromGateway(
    client: DatabaseClient,
    userId: string,
    amountKobo: bigint,
    feeKobo: bigint,
    reference: string,
    metadata?: Record<string, unknown>
  ): Promise<{ journalEntryId: string; balance: WalletBalance }> {
    const userAvailAcc = LedgerService.getUserAvailableAccountId(userId);
    const netDeposit = amountKobo - feeKobo;

    // Balanced Journal Entry:
    // DR 1010-GATEWAY-ESCROW (Asset up by gross amount)
    // CR 2010-USER-AVAILABLE (Liability up by net amount)
    // CR 4020-TRANSACTION-FEES (Revenue up by fee if any) or DR 5020 for fee
    const lines = [
      { accountId: '1010-GATEWAY-ESCROW', direction: 'DEBIT' as const, amountKobo },
      { accountId: userAvailAcc, direction: 'CREDIT' as const, amountKobo: netDeposit },
    ];

    if (feeKobo > 0n) {
      lines.push({ accountId: '5020-PAYMENT-GATEWAY-FEES', direction: 'CREDIT' as const, amountKobo: feeKobo });
    }

    const journalEntryId = await LedgerService.postJournalEntry(client, {
      reference,
      description: `Wallet funding via gateway ref: ${reference}`,
      entryType: 'WALLET_FUNDING',
      metadata,
      lines,
    });

    // Update wallet balance cache atomically
    const updRes = await client.query<{
      user_id: string;
      available_kobo: string;
      locked_kobo: string;
      currency: string;
      updated_at: string;
    }>(
      `UPDATE wallet_balances
       SET available_kobo = available_kobo + $2,
           last_journal_entry_id = $3,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, netDeposit.toString(), journalEntryId]
    );

    const row = updRes.rows[0];
    return {
      journalEntryId,
      balance: {
        userId: row.user_id,
        availableKobo: BigInt(row.available_kobo),
        lockedKobo: BigInt(row.locked_kobo),
        currency: row.currency,
        updatedAt: new Date(row.updated_at),
      },
    };
  }

  /**
   * Funds user wallet in Sandbox/Test environment only
   */
  static async mockFundWallet(
    client: DatabaseClient,
    userId: string,
    amountKobo: bigint,
    reference: string
  ): Promise<{ journalEntryId: string; balance: WalletBalance }> {
    const userAvailAcc = LedgerService.getUserAvailableAccountId(userId);

    // Balanced Journal:
    // DR 2090-SANDBOX-FUNDING (Simulated Liability/Equity offset)
    // CR 2010-USER-AVAILABLE (User available balance up)
    const journalEntryId = await LedgerService.postJournalEntry(client, {
      reference,
      description: `Mock sandbox funding ref: ${reference}`,
      entryType: 'MOCK_SANDBOX_FUNDING',
      metadata: { sandbox: true },
      lines: [
        { accountId: '2090-SANDBOX-FUNDING', direction: 'DEBIT', amountKobo },
        { accountId: userAvailAcc, direction: 'CREDIT', amountKobo },
      ],
    });

    const updRes = await client.query<{
      user_id: string;
      available_kobo: string;
      locked_kobo: string;
      currency: string;
      updated_at: string;
    }>(
      `UPDATE wallet_balances
       SET available_kobo = available_kobo + $2,
           last_journal_entry_id = $3,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, amountKobo.toString(), journalEntryId]
    );

    const row = updRes.rows[0];
    return {
      journalEntryId,
      balance: {
        userId: row.user_id,
        availableKobo: BigInt(row.available_kobo),
        lockedKobo: BigInt(row.locked_kobo),
        currency: row.currency,
        updatedAt: new Date(row.updated_at),
      },
    };
  }

  /**
   * Locks wallet balance for VTU purchase (DR 2010 Available / CR 2020 Locked)
   * Enforces Available >= amountKobo atomically with row lock
   */
  static async holdFundsForPurchase(
    client: DatabaseClient,
    userId: string,
    amountKobo: bigint,
    reference: string
  ): Promise<{ journalEntryId: string }> {
    // 1. Lock wallet row FOR UPDATE
    const curRes = await client.query<{ available_kobo: string }>(
      `SELECT available_kobo FROM wallet_balances WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );

    if (curRes.rows.length === 0 || BigInt(curRes.rows[0].available_kobo) < amountKobo) {
      throw new InsufficientFundsError(
        `Insufficient available funds. Required: ${amountKobo} Kobo, Available: ${curRes.rows[0]?.available_kobo ?? 0} Kobo`
      );
    }

    const userAvailAcc = LedgerService.getUserAvailableAccountId(userId);
    const userLockAcc = LedgerService.getUserLockedAccountId(userId);

    // Balanced Journal:
    // DR 2010-USER-AVAILABLE: available decreases
    // CR 2020-USER-LOCKED: locked increases
    const journalEntryId = await LedgerService.postJournalEntry(client, {
      reference: `HOLD:${reference}`,
      description: `Hold funds for purchase ref: ${reference}`,
      entryType: 'VTU_PURCHASE_HOLD',
      lines: [
        { accountId: userAvailAcc, direction: 'DEBIT', amountKobo },
        { accountId: userLockAcc, direction: 'CREDIT', amountKobo },
      ],
    });

    // 2. Update balances
    await client.query(
      `UPDATE wallet_balances
       SET available_kobo = available_kobo - $2,
           locked_kobo = locked_kobo + $2,
           last_journal_entry_id = $3,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, amountKobo.toString(), journalEntryId]
    );

    return { journalEntryId };
  }

  /**
   * Settles transaction on fulfillment success:
   * DR 2020-USER-LOCKED: locked funds cleared
   * DR 5010-VTU-COST-OF-GOODS: wholesale cost recorded
   * CR 1020-PROVIDER-FLOAT:<PROVIDER>: provider float balance reduced
   * CR 4010-VTU-COMMISSION: margin realized
   */
  static async settlePurchaseSuccess(
    client: DatabaseClient,
    userId: string,
    amountKobo: bigint,
    costKobo: bigint,
    providerName: string,
    reference: string
  ): Promise<{ journalEntryId: string }> {
    const userLockAcc = LedgerService.getUserLockedAccountId(userId);
    const providerFloatAcc = LedgerService.getProviderFloatAccountId(providerName);
    const marginKobo = amountKobo - costKobo;

    const lines = [
      { accountId: userLockAcc, direction: 'DEBIT' as const, amountKobo },
      { accountId: '5010-VTU-COST-OF-GOODS', direction: 'DEBIT' as const, amountKobo: costKobo },
      { accountId: providerFloatAcc, direction: 'CREDIT' as const, amountKobo: costKobo },
    ];

    if (marginKobo > 0n) {
      lines.push({ accountId: '4010-VTU-COMMISSION', direction: 'CREDIT' as const, amountKobo: marginKobo });
    } else if (marginKobo < 0n) {
      // Subsidized transaction (margin is negative, cost > amount)
      lines.push({ accountId: '5030-OPERATIONAL-LOSS', direction: 'DEBIT' as const, amountKobo: -marginKobo });
    }

    const journalEntryId = await LedgerService.postJournalEntry(client, {
      reference: `SETTLE:${reference}`,
      description: `Settlement for successful VTU ref: ${reference}`,
      entryType: 'VTU_PURCHASE_SETTLE',
      lines,
    });

    // Update balances: clear locked funds
    await client.query(
      `UPDATE wallet_balances
       SET locked_kobo = locked_kobo - $2,
           last_journal_entry_id = $3,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, amountKobo.toString(), journalEntryId]
    );

    return { journalEntryId };
  }

  /**
   * Releases locked funds back to available on fulfillment failure
   * DR 2020-USER-LOCKED: locked funds cleared
   * CR 2010-USER-AVAILABLE: funds returned to user available
   */
  static async releaseHeldFundsOnFailure(
    client: DatabaseClient,
    userId: string,
    amountKobo: bigint,
    reference: string,
    reason: string
  ): Promise<{ journalEntryId: string }> {
    const userAvailAcc = LedgerService.getUserAvailableAccountId(userId);
    const userLockAcc = LedgerService.getUserLockedAccountId(userId);

    const journalEntryId = await LedgerService.postJournalEntry(client, {
      reference: `RELEASE:${reference}`,
      description: `Release hold on failed VTU ref: ${reference}. Reason: ${reason}`,
      entryType: 'VTU_PURCHASE_RELEASE',
      metadata: { reason },
      lines: [
        { accountId: userLockAcc, direction: 'DEBIT', amountKobo },
        { accountId: userAvailAcc, direction: 'CREDIT', amountKobo },
      ],
    });

    await client.query(
      `UPDATE wallet_balances
       SET locked_kobo = locked_kobo - $2,
           available_kobo = available_kobo + $2,
           last_journal_entry_id = $3,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, amountKobo.toString(), journalEntryId]
    );

    return { journalEntryId };
  }
}
