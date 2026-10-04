import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Wallet } from '../../domain/entities/wallet.entity.js';
import { Money } from '../../domain/value-objects/money.vo.js';
import type {
  StoredTransaction,
  WalletTransactionContext,
  WalletUnitOfWork,
} from '../../application/ports/wallet-unit-of-work.port.js';

export class PostgresWalletUnitOfWork implements WalletUnitOfWork {
  public constructor(private readonly pool: Pool) {}

  public async transactional<T>(work: (context: WalletTransactionContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PostgresWalletTransactionContext(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

class PostgresWalletTransactionContext implements WalletTransactionContext {
  private lockedWalletId: string | undefined;

  public constructor(private readonly client: PoolClient) {}

  public async findTransactionByIdempotencyKey(key: string): Promise<StoredTransaction | undefined> {
    const result = await this.client.query<{
      id: string; provider_id: string; external_transaction_id: string; idempotency_key: string; payload_hash: string;
      wallet_id: string; player_id: string; round_id: string; game_id: string; kind: string;
      money_amount: string; money_currency: string; reference_external_transaction_id: string | null;
      status: 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';
      failure_code: string | null; balance_amount: string; balance_currency: string;
    }>(
      `SELECT id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id,
              round_id, game_id, kind, money_amount, money_currency, reference_external_transaction_id,
              status, failure_code, balance_amount, balance_currency
       FROM wager_transactions WHERE idempotency_key = $1`, [key],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      providerId: row.provider_id,
      externalTransactionId: row.external_transaction_id,
      idempotencyKey: row.idempotency_key,
      payloadHash: row.payload_hash,
      walletId: row.wallet_id,
      playerId: row.player_id,
      roundId: row.round_id,
      gameId: row.game_id,
      kind: row.kind,
      money: { amount: row.money_amount, currency: row.money_currency.trim() },
      referenceExternalTransactionId: row.reference_external_transaction_id ?? undefined,
      status: row.status,
      failureCode: row.failure_code ?? undefined,
      balance: { amount: row.balance_amount, currency: row.balance_currency.trim() },
    };
  }

  public async findTransactionByExternalReference(providerId: string, externalTransactionId: string): Promise<StoredTransaction | undefined> {
    const result = await this.client.query(
      `SELECT id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
              player_id, round_id, game_id, kind, money_amount, money_currency,
              reference_external_transaction_id, status, balance_amount, balance_currency
       FROM wager_transactions
       WHERE provider_id = $1 AND external_transaction_id = $2`,
      [providerId, externalTransactionId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      providerId: row.provider_id,
      externalTransactionId: row.external_transaction_id,
      idempotencyKey: row.idempotency_key,
      payloadHash: row.payload_hash,
      walletId: row.wallet_id,
      playerId: row.player_id,
      roundId: row.round_id,
      gameId: row.game_id,
      kind: row.kind,
      money: { amount: row.money_amount, currency: row.money_currency.trim() },
      referenceExternalTransactionId: row.reference_external_transaction_id ?? undefined,
      status: row.status,
      balance: { amount: row.balance_amount, currency: row.balance_currency.trim() },
    };
  }

  public async findWalletForUpdate(walletId: string): Promise<Wallet | undefined> {
    const result = await this.client.query<{
      id: string; player_id: string; currency: string; balance: string; version: number;
      created_at: Date; updated_at: Date;
    }>(
      `SELECT id, player_id, currency, balance, version, created_at, updated_at
       FROM wallets WHERE id = $1 FOR UPDATE`, [walletId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    this.lockedWalletId = row.id;
    return Wallet.rehydrate({
      id: row.id,
      playerId: row.player_id,
      currency: row.currency.trim(),
      balance: Money.from({ amount: row.balance, currency: row.currency.trim() }),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  public async saveWallet(wallet: Wallet): Promise<void> {
    await this.client.query(
      `UPDATE wallets SET balance = $1, version = $2, updated_at = $3 WHERE id = $4`,
      [wallet.balance.toJSON().amount, wallet.version, wallet.updatedAt, wallet.id],
    );
  }

  public async saveTransaction(transaction: StoredTransaction): Promise<void> {
    await this.client.query(
      `INSERT INTO wager_transactions
       (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id,
        round_id, game_id, kind, money_amount, money_currency, reference_external_transaction_id,
        status, failure_code, balance_amount, balance_currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [transaction.id, transaction.providerId, transaction.externalTransactionId, transaction.idempotencyKey,
        transaction.payloadHash, transaction.walletId, transaction.playerId, transaction.roundId, transaction.gameId,
        transaction.kind, transaction.money.amount, transaction.money.currency, transaction.referenceExternalTransactionId,
        transaction.status, transaction.failureCode ?? null, transaction.balance.amount, transaction.balance.currency],
    );
  }

  public async updateTransaction(transaction: StoredTransaction): Promise<void> {
    await this.client.query(
      `UPDATE wager_transactions
       SET status = $2, failure_code = $3, balance_amount = $4, balance_currency = $5
       WHERE id = $1`,
      [transaction.id, transaction.status, transaction.failureCode ?? null,
        transaction.balance.amount, transaction.balance.currency],
    );
  }

  public async appendLedgerEntry(entry: {
    transactionId: string;
    walletId: string;
    amount: string;
    currency: string;
    kind: string;
    balanceBefore: { amount: string; currency: string };
    balanceAfter: { amount: string; currency: string };
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO wallet_ledger_entries
       (transaction_id, wallet_id, amount, currency, kind, balance_before, balance_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.transactionId, entry.walletId, entry.amount, entry.currency, entry.kind,
        entry.balanceBefore.amount, entry.balanceAfter.amount],
    );
  }

  public async enqueueOutbox(event: { transactionId: string; walletId: string; kind: string }): Promise<void> {
    const eventPayload = {
      eventId: randomUUID(),
      eventType: `WAGER_${event.kind}`,
      aggregateId: event.walletId,
      correlationId: event.transactionId,
      causationId: event.transactionId,
      occurredAt: new Date().toISOString(),
      version: 1,
      data: event,
    };
    for (const eventType of [eventPayload.eventType, 'WalletBalanceChanged']) {
      const payload = { ...eventPayload, eventId: randomUUID(), eventType };
      await this.client.query(
        `INSERT INTO outbox_messages (transaction_id, wallet_id, event_type, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [event.transactionId, event.walletId, eventType, JSON.stringify(payload)],
      );
    }
  }

  private get walletId(): string {
    if (!this.lockedWalletId) throw new Error('Wallet must be locked before saving a transaction');
    return this.lockedWalletId;
  }
}
