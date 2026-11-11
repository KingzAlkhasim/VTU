-- Migration 001: Core VTU schema
-- Apply to an isolated development/staging database first. Do not run against production
-- until the migration has been reviewed and explicitly approved.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  account_number TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  user_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts(user_id);

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  entry_direction TEXT NOT NULL CHECK (entry_direction IN ('DEBIT', 'CREDIT')),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines(account_id);

-- Enforce balanced journal entries at COMMIT, after all lines have been inserted.
CREATE OR REPLACE FUNCTION assert_journal_entry_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_id UUID;
  debit_total NUMERIC;
  credit_total NUMERIC;
  line_count BIGINT;
BEGIN
  target_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  IF target_id IS NULL THEN
    target_id := COALESCE(NEW.id, OLD.id);
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(amount_kobo) FILTER (WHERE entry_direction = 'DEBIT'), 0),
    COALESCE(SUM(amount_kobo) FILTER (WHERE entry_direction = 'CREDIT'), 0)
  INTO line_count, debit_total, credit_total
  FROM journal_lines
  WHERE journal_entry_id = target_id;

  IF line_count < 2 OR debit_total <> credit_total THEN
    RAISE EXCEPTION
      'Journal entry % is not balanced: lines %, debits %, credits %',
      target_id, line_count, debit_total, credit_total
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS journal_entry_balance_check ON journal_entries;
CREATE CONSTRAINT TRIGGER journal_entry_balance_check
AFTER INSERT OR UPDATE ON journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();

DROP TRIGGER IF EXISTS journal_line_balance_check ON journal_lines;
CREATE CONSTRAINT TRIGGER journal_line_balance_check
AFTER INSERT OR UPDATE OR DELETE ON journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();

CREATE TABLE IF NOT EXISTS wallet_balances (
  user_id TEXT PRIMARY KEY,
  available_kobo BIGINT NOT NULL DEFAULT 0 CHECK (available_kobo >= 0),
  locked_kobo BIGINT NOT NULL DEFAULT 0 CHECK (locked_kobo >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  last_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'RESOLVED')),
  lock_token UUID NOT NULL DEFAULT gen_random_uuid(),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  response_code INTEGER,
  response_headers JSONB,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key),
  CHECK (
    (status = 'PROCESSING' AND response_code IS NULL)
    OR
    (status = 'RESOLVED' AND response_code BETWEEN 100 AND 599)
  )
);

CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_records(expires_at);

CREATE TABLE IF NOT EXISTS vtu_products (
  id TEXT PRIMARY KEY,
  service_type TEXT NOT NULL CHECK (service_type IN ('airtime', 'data', 'electricity', 'cable')),
  operator TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_kobo BIGINT CHECK (amount_kobo IS NULL OR amount_kobo > 0),
  cost_kobo BIGINT CHECK (cost_kobo IS NULL OR cost_kobo >= 0),
  validity TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vtu_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES vtu_products(id) ON DELETE RESTRICT,
  service_type TEXT NOT NULL,
  operator TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  cost_kobo BIGINT NOT NULL CHECK (cost_kobo >= 0),
  status TEXT NOT NULL CHECK (status IN ('INITIATED', 'HOLDING', 'PROCESSING', 'FULFILLED', 'FAILED', 'UNKNOWN', 'REFUNDED')),
  provider_name TEXT NOT NULL,
  provider_reference TEXT,
  provider_response JSONB,
  failure_reason TEXT,
  check_count INTEGER NOT NULL DEFAULT 0 CHECK (check_count >= 0),
  last_checked_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  hold_journal_entry_id UUID REFERENCES journal_entries(id),
  settle_journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vtu_transactions_user_created_idx ON vtu_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vtu_transactions_reconcile_idx ON vtu_transactions(status, next_retry_at)
  WHERE status IN ('PROCESSING', 'UNKNOWN');

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  raw_body BYTEA NOT NULL,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  UNIQUE(provider_name, provider_event_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
