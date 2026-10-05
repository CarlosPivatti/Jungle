import type { InboxEvent, IntegrationEventHandler } from '../../application/ports/inbox.port.js';
import { MetricsRegistry } from '../observability/metrics.registry.js';
import { logStructured } from '../observability/structured-logger.js';

export class WagerEventHandler implements IntegrationEventHandler {
  public constructor(private readonly metrics: MetricsRegistry) {}

  public async handle(event: InboxEvent): Promise<void> {
    const startedAt = performance.now();
    if (!event.eventId || !event.eventType || !event.payload) {
      throw new Error('INVALID_EVENT_ENVELOPE');
    }
    this.metrics.increment('inbox_events_processed_total');
    this.metrics.observe('inbox_processing_duration_seconds', (performance.now() - startedAt) / 1000, { eventType: event.eventType });
    logStructured('info', 'wager_event_processed', {
      eventId: event.eventId,
      eventType: event.eventType,
      transactionId: event.payload.transactionId,
      walletId: event.payload.walletId,
    });
  }
}
