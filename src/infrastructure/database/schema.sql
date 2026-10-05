CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE wallets (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL,
  currency CHAR(3) NOT NULL,
  balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0),
  CONSTRAINT wallets_player_currency_unique UNIQUE (player_id, currency)
);

CREATE TABLE wager_transactions (
  id UUID PRIMARY KEY,
  provider_id TEXT NOT NULL DEFAULT 'default-provider',
  external_transaction_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  player_id UUID NOT NULL,
  round_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
  money_amount NUMERIC(18, 2) NOT NULL,
  money_currency CHAR(3) NOT NULL,
  reference_external_transaction_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
  failure_code TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  balance_amount NUMERIC(18, 2) NOT NULL,
  balance_currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wager_provider_external_unique UNIQUE (provider_id, external_transaction_id),
  CONSTRAINT wager_reference_unique UNIQUE (provider_id, reference_external_transaction_id, kind)
);

CREATE TABLE wallet_ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES wager_transactions(id),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount NUMERIC(18, 2) NOT NULL,
  currency CHAR(3) NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CREDIT', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
  balance_before NUMERIC(18, 2) NOT NULL,
  balance_after NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_transaction_unique UNIQUE (transaction_id)
);

CREATE TABLE outbox_messages (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES wager_transactions(id),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outbox_event_id_unique UNIQUE (event_id)
);

CREATE INDEX outbox_pending_idx ON outbox_messages (created_at) WHERE published_at IS NULL;

CREATE TABLE inbox_messages (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
