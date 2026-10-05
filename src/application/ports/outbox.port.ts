export interface OutboxMessage {
  id: number;
  transactionId: string;
  walletId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt?: Date;
}

export interface OutboxRepository {
  transactional<T>(work: (repository: OutboxRepository) => Promise<T>): Promise<T>;
  lockPendingBatch(limit: number): Promise<OutboxMessage[]>;
  markPublished(id: number): Promise<void>;
}

export interface IntegrationEventPublisher {
  publish(message: OutboxMessage): Promise<void>;
}
