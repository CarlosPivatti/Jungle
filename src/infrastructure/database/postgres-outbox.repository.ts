import { Pool, type PoolClient } from 'pg';
import type { OutboxMessage, OutboxRepository } from '../../application/ports/outbox.port.js';

export class PostgresOutboxRepository implements OutboxRepository {
  public constructor(private readonly pool: Pool) {}

  public async transactional<T>(work: (repository: OutboxRepository) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PostgresOutboxTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
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
  public constructor(private readonly client: PoolClient) {}

  public async transactional<T>(work: (repository: OutboxRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  public async lockPendingBatch(limit: number): Promise<OutboxMessage[]> {
    const result = await this.client.query<{
      id: number;
      transaction_id: string;
      wallet_id: string;
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, transaction_id, wallet_id, event_type, payload
       FROM outbox_messages
       WHERE published_at IS NULL
       ORDER BY id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      transactionId: row.transaction_id,
      walletId: row.wallet_id,
      eventType: row.event_type,
      payload: row.payload,
    }));
  }

  public async markPublished(id: number): Promise<void> {
    await this.client.query(
      'UPDATE outbox_messages SET published_at = NOW() WHERE id = $1 AND published_at IS NULL',
      [id],
    );
  }
}
