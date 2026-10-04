ALTER TABLE outbox_messages
  DROP CONSTRAINT IF EXISTS outbox_transaction_unique;
