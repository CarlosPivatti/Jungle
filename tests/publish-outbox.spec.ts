import { describe, expect, it } from 'vitest';
import { PublishOutboxUseCase } from '../src/application/use-cases/publish-outbox.use-case.js';
import type { IntegrationEventPublisher, OutboxMessage, OutboxRepository } from '../src/application/ports/outbox.port.js';

function createHarness(messages: OutboxMessage[]) {
  const published: number[] = [];
  const repository: OutboxRepository = {
    transactional: async (work) => work(repository),
    lockPendingBatch: async (limit) => messages.slice(0, limit),
    markPublished: async (id) => { published.push(id); },
  };
  const publisher: IntegrationEventPublisher = {
    publish: async (message) => { published.push(message.id); },
  };
  return { published, useCase: new PublishOutboxUseCase(repository, publisher, 2) };
}

const messages: OutboxMessage[] = [
  { id: 1, transactionId: 'tx-1', walletId: 'wallet-1', eventType: 'WagerTransactionProcessed', payload: { amount: '10.00' } },
  { id: 2, transactionId: 'tx-2', walletId: 'wallet-1', eventType: 'WalletBalanceChanged', payload: { amount: '20.00' } },
  { id: 3, transactionId: 'tx-3', walletId: 'wallet-1', eventType: 'WagerTransactionProcessed', payload: { amount: '5.00' } },
];

describe('PublishOutboxUseCase', () => {
  it('publishes and marks only one batch', async () => {
    const harness = createHarness(messages);

    const count = await harness.useCase.execute();

    expect(count).toBe(2);
    expect(harness.published).toEqual([1, 1, 2, 2]);
  });

  it('does not mark a message after publisher failure', async () => {
    const marked: number[] = [];
    const repository: OutboxRepository = {
      transactional: async (work) => work(repository),
      lockPendingBatch: async () => messages,
      markPublished: async (id) => { marked.push(id); },
    };
    const publisher: IntegrationEventPublisher = {
      publish: async (message) => {
        if (message.id === 2) throw new Error('SQS_UNAVAILABLE');
      },
    };

    await expect(new PublishOutboxUseCase(repository, publisher).execute()).rejects.toThrow('SQS_UNAVAILABLE');
    expect(marked).toEqual([1]);
  });
});
