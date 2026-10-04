import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { ProcessWagerUseCase } from '../../application/use-cases/process-wager.use-case.js';
import { logStructured } from '../observability/structured-logger.js';

@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly pool: Pool,
    private readonly processWager: ProcessWagerUseCase,
    private readonly pollIntervalMs = 1000,
  ) {}

  public async runOnce(): Promise<number> {
    const result = await this.pool.query<{
      provider_id: string;
      external_transaction_id: string;
      idempotency_key: string;
      payload_hash: string;
      wallet_id: string;
      round_id: string;
      game_id: string;
      kind: 'REFUND' | 'ROLLBACK';
      money_amount: string;
      money_currency: string;
      reference_external_transaction_id: string;
    }>(
      `SELECT provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
              round_id, game_id, kind, money_amount, money_currency,
              reference_external_transaction_id
       FROM wager_transactions
       WHERE status = 'PENDING_REFERENCE'
         AND next_attempt_at <= NOW()
       ORDER BY created_at
       LIMIT 50`,
    );

    let processed = 0;
    for (const row of result.rows) {
      try {
        await this.processWager.execute({
          providerId: row.provider_id,
          externalTransactionId: row.external_transaction_id,
          idempotencyKey: row.idempotency_key,
          payloadHash: row.payload_hash,
          walletId: row.wallet_id,
          roundId: row.round_id,
          gameId: row.game_id,
          kind: row.kind,
          money: { amount: row.money_amount, currency: row.money_currency.trim() },
          referenceExternalTransactionId: row.reference_external_transaction_id,
        });
        processed += 1;
      } catch (error) {
        await this.pool.query(
          `UPDATE wager_transactions
           SET attempt_count = attempt_count + 1,
               next_attempt_at = NOW() + LEAST(INTERVAL '1 hour', INTERVAL '1 second' * POWER(2, attempt_count + 1))
           WHERE idempotency_key = $1`,
          [row.idempotency_key],
        );
        logStructured('warn', 'pending_reference_retry_scheduled', {
          idempotencyKey: row.idempotency_key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return processed;
  }

  public onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => logStructured('error', 'pending_reference_worker_failed', {
        error: error instanceof Error ? error.message : String(error),
      }));
    }, this.pollIntervalMs);
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
