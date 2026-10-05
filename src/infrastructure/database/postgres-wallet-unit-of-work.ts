import { DataSource, type QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Wallet } from '../../domain/entities/wallet.entity.js';
import { Money } from '../../domain/value-objects/money.vo.js';
import type {
  StoredTransaction,
  WalletTransactionContext,
  WalletUnitOfWork,
} from '../../application/ports/wallet-unit-of-work.port.js';

export class PostgresWalletUnitOfWork implements WalletUnitOfWork {
  public constructor(private readonly dataSource: DataSource) {}

  public async transactional<T>(work: (context: WalletTransactionContext) => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      const result = await work(new PostgresWalletTransactionContext(runner));
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  public async recordFailedTransaction(input: Parameters<NonNullable<WalletUnitOfWork['recordFailedTransaction']>>[0]): Promise<StoredTransaction> {
    return this.recordTerminalTransaction(input, 'FAILED');
  }

  public async recordRejectedTransaction(input: Parameters<NonNullable<WalletUnitOfWork['recordRejectedTransaction']>>[0]): Promise<StoredTransaction> {
    return this.recordTerminalTransaction(input, 'REJECTED');
  }

  private async recordTerminalTransaction(
    input: Parameters<NonNullable<WalletUnitOfWork['recordFailedTransaction']>>[0],
    status: 'FAILED' | 'REJECTED',
  ): Promise<StoredTransaction> {
    return this.transactional(async (context) => {
        const existing = await context.findTransactionByIdempotencyKey(input.idempotencyKey);
        if (existing) return existing;
        const wallet = await context.findWalletForUpdate(input.walletId);
        const balance = wallet?.balance.toJSON() ?? { amount: '0.00', currency: input.money.currency };
        const transaction: StoredTransaction = {
          id: randomUUID(),
          providerId: input.providerId,
          externalTransactionId: input.externalTransactionId,
          idempotencyKey: input.idempotencyKey,
          payloadHash: input.payloadHash,
          walletId: input.walletId,
          playerId: wallet?.playerId ?? '00000000-0000-0000-0000-000000000000',
          roundId: input.roundId,
          gameId: input.gameId,
          kind: input.kind,
          money: input.money,
          referenceExternalTransactionId: input.referenceExternalTransactionId,
          status,
          failureCode: input.failureCode,
          balance,
        };
        await context.saveTransaction(transaction);
        await context.enqueueOutbox({
          transactionId: transaction.id,
          walletId: transaction.walletId,
          kind: transaction.kind,
          status,
        });
        return transaction;
    });
  }
}

class PostgresWalletTransactionContext implements WalletTransactionContext {
  private lockedWalletId: string | undefined;

  public constructor(private readonly client: QueryRunner) {}

  public async findTransactionByIdempotencyKey(key: string): Promise<StoredTransaction | undefined> {
    const result = await this.query(
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
    const result = await this.query(
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
    const result = await this.query(
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

  public async enqueueOutbox(event: { transactionId: string; walletId: string; kind: string; status: 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED' }): Promise<void> {
    const eventPayload = {
      eventId: randomUUID(),
      eventType: event.status === 'PROCESSED'
        ? 'WagerTransactionProcessed'
        : event.status === 'REJECTED'
              ? 'WagerTransactionRejected'
              : event.status === 'FAILED'
                ? 'WagerTransactionFailed'
                : 'WagerTransactionPendingReference',
      aggregateId: event.walletId,
      correlationId: event.transactionId,
      causationId: event.transactionId,
      occurredAt: new Date().toISOString(),
      version: 1,
      data: event,
    };
    const eventTypes = event.status === 'PROCESSED'
      ? [eventPayload.eventType, 'WalletBalanceChanged']
      : [eventPayload.eventType];
    for (const eventType of eventTypes) {
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

  private async query(sql: string, parameters: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const rows = await this.client.query(sql, parameters) as any[];
    return { rows, rowCount: rows.length };
  }
}
