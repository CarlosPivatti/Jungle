import { DataSource, type QueryRunner } from 'typeorm';
import type { OutboxMessage, OutboxRepository } from '../../application/ports/outbox.port.js';

export class PostgresOutboxRepository implements OutboxRepository {
  public constructor(private readonly dataSource: DataSource) {}

  public async transactional<T>(work: (repository: OutboxRepository) => Promise<T>): Promise<T> {
    const client = this.dataSource.createQueryRunner();
    await client.connect();
    try {
      await client.startTransaction();
      const result = await work(new PostgresOutboxTransaction(client));
      await client.commitTransaction();
      return result;
    } catch (error) {
      await client.rollbackTransaction();
      throw error;
    } finally {
      await client.release();
    }
  }

  public async lockPendingBatch(_limit: number): Promise<OutboxMessage[]> {
    throw new Error('lockPendingBatch must be called inside transactional()');
  }

  public async markPublished(_id: number): Promise<void> {
    throw new Error('markPublished must be called inside transactional()');
  }
}

class PostgresOutboxTransaction implements OutboxRepository {
  public constructor(private readonly client: QueryRunner) {}

  public async transactional<T>(work: (repository: OutboxRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  public async lockPendingBatch(limit: number): Promise<OutboxMessage[]> {
    const rows = await this.client.query(
      `SELECT id, transaction_id, wallet_id, event_type, payload, created_at
       FROM outbox_messages
       WHERE published_at IS NULL
       ORDER BY id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );

    return rows.map((row: {
      id: number; transaction_id: string; wallet_id: string; event_type: string; payload: Record<string, unknown>; created_at: Date;
    }) => ({
      id: row.id,
      transactionId: row.transaction_id,
      walletId: row.wallet_id,
      eventType: row.event_type,
      payload: row.payload,
      createdAt: row.created_at,
    }));
  }

  public async markPublished(id: number): Promise<void> {
    await this.client.query(
      'UPDATE outbox_messages SET published_at = NOW() WHERE id = $1 AND published_at IS NULL',
      [id],
    );
  }
}
