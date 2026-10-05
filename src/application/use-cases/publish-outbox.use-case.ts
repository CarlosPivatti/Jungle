import type {
  IntegrationEventPublisher,
  OutboxRepository,
} from '../ports/outbox.port.js';
import type { MetricsRegistry } from '../../infrastructure/observability/metrics.registry.js';

export class PublishOutboxUseCase {
  public constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: IntegrationEventPublisher,
    private readonly batchSize = 50,
    private readonly metrics?: MetricsRegistry,
  ) {}

  public async execute(): Promise<number> {
    return this.repository.transactional(async (transaction) => {
      const messages = await transaction.lockPendingBatch(this.batchSize);
      const oldest = messages[0];
      if (oldest?.createdAt) this.metrics?.observe('outbox_lag_seconds', (Date.now() - oldest.createdAt.getTime()) / 1000, { eventType: oldest.eventType });

      for (const message of messages) {
        await this.publisher.publish(message);
        await transaction.markPublished(message.id);
      }

      return messages.length;
    });
  }
}
