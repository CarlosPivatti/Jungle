import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProcessWagerUseCase } from '../../application/use-cases/process-wager.use-case.js';
import { logStructured } from '../observability/structured-logger.js';
import { MetricsRegistry } from '../observability/metrics.registry.js';

@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy {
  private static readonly maxAttempts = 5;
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly dataSource: DataSource,
    private readonly processWager: ProcessWagerUseCase,
    private readonly metrics?: MetricsRegistry,
    private readonly pollIntervalMs = 1000,
  ) {}

  public async runOnce(): Promise<number> {
    const result = await this.dataSource.query(
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
    for (const row of result as Array<{
      provider_id: string; external_transaction_id: string; idempotency_key: string;
      payload_hash: string; wallet_id: string; round_id: string; game_id: string;
      kind: 'REFUND' | 'ROLLBACK'; money_amount: string; money_currency: string;
      reference_external_transaction_id: string;
    }>) {
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
        const retry = await this.dataSource.query(
          `UPDATE wager_transactions
           SET attempt_count = attempt_count + 1,
               status = CASE WHEN attempt_count + 1 >= $2 THEN 'REJECTED' ELSE status END,
               failure_code = CASE WHEN attempt_count + 1 >= $2 THEN 'REFERENCE_NOT_FOUND' ELSE failure_code END,
               next_attempt_at = NOW() + LEAST(INTERVAL '1 hour', INTERVAL '1 second' * POWER(2, attempt_count + 1))
           WHERE idempotency_key = $1
           RETURNING attempt_count`,
          [row.idempotency_key, PendingReferenceWorker.maxAttempts],
        );
        this.metrics?.increment('wager_retries_total', { kind: row.kind });
        if (((retry as Array<{ attempt_count: number }>)[0]?.attempt_count ?? 0) >= PendingReferenceWorker.maxAttempts) {
          await this.dataSource.query(
            `INSERT INTO outbox_messages (transaction_id, wallet_id, event_type, payload)
             SELECT id, wallet_id, 'WagerTransactionRejected',
                    jsonb_build_object(
                      'eventId', gen_random_uuid(), 'eventType', 'WagerTransactionRejected',
                      'aggregateId', wallet_id, 'correlationId', id, 'causationId', id,
                      'occurredAt', NOW(), 'version', 1,
                      'data', jsonb_build_object('transactionId', id, 'walletId', wallet_id,
                        'kind', kind, 'status', 'REJECTED', 'failureCode', 'REFERENCE_NOT_FOUND')
                    )
             FROM wager_transactions
             WHERE idempotency_key = $1
               AND status = 'REJECTED'
               AND failure_code = 'REFERENCE_NOT_FOUND'
             ON CONFLICT (transaction_id) WHERE event_type = 'WagerTransactionRejected' DO NOTHING`,
            [row.idempotency_key],
          );
        }
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
