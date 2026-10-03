import type { InboxEvent, IntegrationEventHandler } from '../../application/ports/inbox.port.js';

export class NoopEventHandler implements IntegrationEventHandler {
  public async handle(_event: InboxEvent): Promise<void> {
    return Promise.resolve();
  }
}
