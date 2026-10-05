ALTER TABLE wager_transactions
  DROP CONSTRAINT IF EXISTS wager_reference_unique;

DROP INDEX IF EXISTS wager_reference_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS wager_reference_unique_by_kind_idx
  ON wager_transactions (provider_id, reference_external_transaction_id, kind)
  WHERE reference_external_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_rejected_transaction_unique_idx
  ON outbox_messages (transaction_id)
  WHERE event_type = 'WagerTransactionRejected';

ALTER TABLE wager_transactions
  DROP CONSTRAINT IF EXISTS wager_transactions_kind_check;

ALTER TABLE wager_transactions
  ADD CONSTRAINT wager_transactions_kind_check
  CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));

ALTER TABLE wallet_ledger_entries
  DROP CONSTRAINT IF EXISTS wallet_ledger_entries_kind_check;

ALTER TABLE wallet_ledger_entries
  ADD CONSTRAINT wallet_ledger_entries_kind_check
  CHECK (kind IN ('CREDIT', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));
