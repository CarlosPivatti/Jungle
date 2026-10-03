import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { IntegrationEventPublisher, OutboxMessage } from '../../application/ports/outbox.port.js';

export class SqsEventPublisher implements IntegrationEventPublisher {
  public constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  public async publish(message: OutboxMessage): Promise<void> {
    await this.client.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify({
        id: message.id,
        transactionId: message.transactionId,
        walletId: message.walletId,
        eventType: message.eventType,
        payload: message.payload,
      }),
      MessageAttributes: {
        eventType: { DataType: 'String', StringValue: message.eventType },
        transactionId: { DataType: 'String', StringValue: message.transactionId },
      },
    }));
  }
}
