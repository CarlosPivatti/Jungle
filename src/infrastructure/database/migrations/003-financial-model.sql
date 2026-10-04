ALTER TABLE wager_transactions
  ADD COLUMN IF NOT EXISTS provider_id TEXT NOT NULL DEFAULT 'default-provider',
  ADD COLUMN IF NOT EXISTS player_id UUID,
  ADD COLUMN IF NOT EXISTS round_id TEXT NOT NULL DEFAULT 'legacy-round',
  ADD COLUMN IF NOT EXISTS game_id TEXT NOT NULL DEFAULT 'legacy-game',
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'BET',
  ADD COLUMN IF NOT EXISTS money_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS money_currency CHAR(3) NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS reference_external_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS status_new TEXT,
  ADD COLUMN IF NOT EXISTS failure_code TEXT;
ALTER TABLE wager_transactions
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE wager_transactions
SET player_id = wallets.player_id
FROM wallets
WHERE wager_transactions.wallet_id = wallets.id
  AND wager_transactions.player_id IS NULL;

UPDATE wager_transactions
SET status_new = status
WHERE status_new IS NULL;

ALTER TABLE wager_transactions
  ALTER COLUMN player_id SET NOT NULL;

ALTER TABLE wager_transactions DROP CONSTRAINT IF EXISTS wager_transactions_external_transaction_id_key;
ALTER TABLE wager_transactions DROP CONSTRAINT IF EXISTS wager_transactions_status_check;
ALTER TABLE wager_transactions DROP COLUMN IF EXISTS status;
ALTER TABLE wager_transactions RENAME COLUMN status_new TO status;
ALTER TABLE wager_transactions
  ADD CONSTRAINT wager_transactions_status_check CHECK (status IN ('PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));

CREATE UNIQUE INDEX IF NOT EXISTS wager_provider_external_unique_idx
  ON wager_transactions (provider_id, external_transaction_id);

CREATE UNIQUE INDEX IF NOT EXISTS wager_reference_unique_idx
  ON wager_transactions (provider_id, reference_external_transaction_id)
  WHERE reference_external_transaction_id IS NOT NULL;

ALTER TABLE wallet_ledger_entries
  ADD COLUMN IF NOT EXISTS balance_before NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_after NUMERIC(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE outbox_messages
  ADD COLUMN IF NOT EXISTS event_id UUID DEFAULT gen_random_uuid();

ALTER TABLE outbox_messages DROP CONSTRAINT IF EXISTS outbox_transaction_unique;
ALTER TABLE outbox_messages ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE outbox_messages ADD CONSTRAINT outbox_event_id_unique UNIQUE (event_id);
