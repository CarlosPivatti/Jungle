import { describe, expect, it } from 'vitest';
import { SqsInboxConsumer } from '../src/infrastructure/queue/sqs-inbox.consumer.js';

describe('SQS inbox redelivery', () => {
  it('does not duplicate the inbox effect when ACK fails after commit', async () => {
    let receiveCount = 0;
    let deleteCount = 0;
    let claimed = false;
    const message = {
      MessageId: 'message-1',
      ReceiptHandle: 'receipt-1',
      Body: JSON.stringify({
        eventId: 'event-1',
        eventType: 'WagerTransactionProcessed',
        data: { transactionId: 'transaction-1' },
      }),
    };
    const client = {
      send: async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === 'ReceiveMessageCommand') {
          receiveCount += 1;
          return receiveCount <= 2 ? { Messages: [message] } : { Messages: [] };
        }
        deleteCount += 1;
        if (deleteCount === 1) throw new Error('WORKER_CRASH_BEFORE_ACK');
        return {};
      },
    };
    const consumeInbox = {
      execute: async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
    };
    const consumer = new SqsInboxConsumer(
      client as never,
      'queue',
      consumeInbox,
      0,
    );

    await consumer.pollOnce();
    await consumer.pollOnce();

    expect(claimed).toBe(true);
    expect(deleteCount).toBe(2);
  });
});
