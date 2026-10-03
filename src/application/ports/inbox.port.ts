export interface InboxEvent {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface InboxRepository {
  transactional<T>(work: (repository: InboxRepository) => Promise<T>): Promise<T>;
  claim(event: InboxEvent): Promise<boolean>;
}

export interface IntegrationEventHandler {
  handle(event: InboxEvent): Promise<void>;
}