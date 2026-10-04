import type { InboxEvent, IntegrationEventHandler } from '../../application/ports/inbox.port.js';
import { MetricsRegistry } from '../observability/metrics.registry.js';
import { logStructured } from '../observability/structured-logger.js';

export class WagerEventHandler implements IntegrationEventHandler {
  public constructor(private readonly metrics: MetricsRegistry) {}

  public async handle(event: InboxEvent): Promise<void> {
    if (!event.eventId || !event.eventType || !event.payload) {
      throw new Error('INVALID_EVENT_ENVELOPE');
    }
    this.metrics.increment('inbox_events_processed_total');
    logStructured('info', 'wager_event_processed', {
      eventId: event.eventId,
      eventType: event.eventType,
      transactionId: event.payload.transactionId,
      walletId: event.payload.walletId,
    });
  }
}
