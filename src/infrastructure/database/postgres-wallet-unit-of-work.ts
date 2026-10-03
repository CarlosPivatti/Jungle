import { Pool, type PoolClient } from 'pg';
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
      id: string; external_transaction_id: string; idempotency_key: string; payload_hash: string; status: 'PROCESSED';
      balance_amount: string; balance_currency: string;
    }>(
      `SELECT id, external_transaction_id, idempotency_key, payload_hash, status, balance_amount, balance_currency
       FROM wager_transactions WHERE idempotency_key = $1`, [key],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      externalTransactionId: row.external_transaction_id,
      idempotencyKey: row.idempotency_key,
      payloadHash: row.payload_hash,
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
       (id, external_transaction_id, idempotency_key, payload_hash, wallet_id, status, balance_amount, balance_currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [transaction.id, transaction.externalTransactionId, transaction.idempotencyKey, transaction.payloadHash, this.walletId, transaction.status, transaction.balance.amount, transaction.balance.currency],
    );
  }

  public async appendLedgerEntry(entry: { transactionId: string; walletId: string; amount: string; currency: string; kind: string }): Promise<void> {
    await this.client.query(
      `INSERT INTO wallet_ledger_entries (transaction_id, wallet_id, amount, currency, kind)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.transactionId, entry.walletId, entry.amount, entry.currency, entry.kind],
    );
  }

  public async enqueueOutbox(event: { transactionId: string; walletId: string; kind: string }): Promise<void> {
    await this.client.query(
      `INSERT INTO outbox_messages (transaction_id, wallet_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [event.transactionId, event.walletId, `WAGER_${event.kind}`, JSON.stringify(event)],
    );
  }

  private get walletId(): string {
    if (!this.lockedWalletId) throw new Error('Wallet must be locked before saving a transaction');
    return this.lockedWalletId;
  }
}
