import { Pool, type PoolClient } from 'pg';
import type { InboxEvent, InboxRepository } from '../../application/ports/inbox.port.js';

export class PostgresInboxRepository implements InboxRepository {
  public constructor(private readonly pool: Pool) {}

  public async transactional<T>(work: (repository: InboxRepository) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PostgresInboxTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async claim(_event: InboxEvent): Promise<boolean> {
    throw new Error('claim must be called inside transactional()');
  }
}

class PostgresInboxTransaction implements InboxRepository {
  public constructor(private readonly client: PoolClient) {}

  public async transactional<T>(work: (repository: InboxRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  public async claim(event: InboxEvent): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO inbox_messages (event_id, event_type, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.eventType, JSON.stringify(event.payload)],
    );
    return result.rowCount === 1;
  }
}
