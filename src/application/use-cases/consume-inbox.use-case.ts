import type { InboxEvent, InboxRepository, IntegrationEventHandler } from '../ports/inbox.port.js';

export class ConsumeInboxUseCase {
  public constructor(
    private readonly repository: InboxRepository,
    private readonly handler: IntegrationEventHandler,
  ) {}

  public async execute(event: InboxEvent): Promise<boolean> {
    return this.repository.transactional(async (transaction) => {
      if (!(await transaction.claim(event))) return false;
      await this.handler.handle(event);
      return true;
    });
  }
}