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
  external_transaction_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  status TEXT NOT NULL CHECK (status = 'PROCESSED'),
  balance_amount NUMERIC(18, 2) NOT NULL,
  balance_currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wallet_ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES wager_transactions(id),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount NUMERIC(18, 2) NOT NULL,
  currency CHAR(3) NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_transaction_unique UNIQUE (transaction_id)
);

CREATE TABLE outbox_messages (
  id BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES wager_transactions(id),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outbox_transaction_unique UNIQUE (transaction_id)
);

CREATE INDEX outbox_pending_idx ON outbox_messages (created_at) WHERE published_at IS NULL;

CREATE TABLE inbox_messages (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
