import { DataSource, type QueryRunner } from 'typeorm';
import type { InboxEvent, InboxRepository } from '../../application/ports/inbox.port.js';

export class PostgresInboxRepository implements InboxRepository {
  public constructor(private readonly dataSource: DataSource) {}

  public async transactional<T>(work: (repository: InboxRepository) => Promise<T>): Promise<T> {
    const client = this.dataSource.createQueryRunner();
    await client.connect();
    try {
      await client.startTransaction();
      const result = await work(new PostgresInboxTransaction(client));
      await client.commitTransaction();
      return result;
    } catch (error) {
      await client.rollbackTransaction();
      throw error;
    } finally {
      await client.release();
    }
  }

  public async claim(_event: InboxEvent): Promise<boolean> {
    throw new Error('claim must be called inside transactional()');
  }
}

class PostgresInboxTransaction implements InboxRepository {
  public constructor(private readonly client: QueryRunner) {}

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
    return result.length === 1;
  }
}
