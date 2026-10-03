import { describe, expect, it } from 'vitest';
import { ConsumeInboxUseCase } from '../src/application/use-cases/consume-inbox.use-case.js';
import type { InboxEvent, InboxRepository, IntegrationEventHandler } from '../src/application/ports/inbox.port.js';

const event: InboxEvent = {
  eventId: 'message-1',
  eventType: 'WAGER_PROCESSED',
  payload: { transactionId: 'tx-1' },
};

describe('ConsumeInboxUseCase', () => {
  it('handles a new event once and ignores duplicates', async () => {
    const claimed = new Set<string>();
    const handled: string[] = [];
    const repository: InboxRepository = {
      transactional: async (work) => work(repository),
      claim: async (message) => {
        if (claimed.has(message.eventId)) return false;
        claimed.add(message.eventId);
        return true;
      },
    };
    const handler: IntegrationEventHandler = {
      handle: async (message) => { handled.push(message.eventId); },
    };
    const useCase = new ConsumeInboxUseCase(repository, handler);

    expect(await useCase.execute(event)).toBe(true);
    expect(await useCase.execute(event)).toBe(false);
    expect(handled).toEqual(['message-1']);
  });
});
