import type {
  IntegrationEventPublisher,
  OutboxRepository,
} from '../ports/outbox.port.js';

export class PublishOutboxUseCase {
  public constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: IntegrationEventPublisher,
    private readonly batchSize = 50,
  ) {}

  public async execute(): Promise<number> {
    return this.repository.transactional(async (transaction) => {
      const messages = await transaction.lockPendingBatch(this.batchSize);

      for (const message of messages) {
        await this.publisher.publish(message);
        await transaction.markPublished(message.id);
      }

      return messages.length;
    });
  }
}
