export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type EntryDirection = 'DEBIT' | 'CREDIT';

export interface Account {
  id: string;
  accountNumber: string;
  name: string;
  type: AccountType;
  currency: string;
  userId?: string;
  isActive: boolean;
  createdAt: Date;
}

export interface JournalLine {
  accountId: string;
  direction: EntryDirection;
  amountKobo: bigint;
}

export interface JournalEntry {
  id?: string;
  reference: string;
  description: string;
  entryType: string;
  metadata?: Record<string, unknown>;
  postedAt?: Date;
  lines: JournalLine[];
}

export interface WalletBalance {
  userId: string;
  availableKobo: bigint;
  lockedKobo: bigint;
  currency: string;
  lastJournalEntryId?: string;
  updatedAt: Date;
}

export type TransactionStatus =
  | 'INITIATED'
  | 'HOLDING'
  | 'PROCESSING'
  | 'FULFILLED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'REFUNDED';

export interface Transaction {
  id: string;
  reference: string;
  userId: string;
  productId: string;
  serviceType: 'airtime' | 'data' | 'electricity' | 'cable';
  operator: string;
  recipientPhone: string;
  amountKobo: bigint;
  costKobo: bigint;
  status: TransactionStatus;
  providerName: string;
  providerReference?: string;
  providerResponse?: Record<string, unknown>;
  failureReason?: string;
  checkCount: number;
  lastCheckedAt?: Date;
  nextRetryAt?: Date;
  holdJournalEntryId?: string;
  settleJournalEntryId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppUser {
  id: string;
  email: string;
  phoneNumber?: string;
  fullName?: string;
  role: 'customer' | 'admin' | 'auditor';
  isSuspended: boolean;
  createdAt: Date;
  updatedAt: Date;
}
