import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ConsumeInboxUseCase } from '../../application/use-cases/consume-inbox.use-case.js';
import type { InboxEvent } from '../../application/ports/inbox.port.js';
import { logStructured } from '../observability/structured-logger.js';

interface SqsMessage {
  MessageId?: string;
  ReceiptHandle?: string;
  Body?: string;
}

export class SqsInboxConsumer implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
    private readonly consumeInbox: ConsumeInboxUseCase,
    private readonly waitTimeSeconds = 10,
  ) {}

  public async pollOnce(): Promise<number> {
    const result = await this.client.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: this.waitTimeSeconds,
      VisibilityTimeout: 30,
      MessageAttributeNames: ['All'],
    }));

    let processed = 0;
    for (const message of (result.Messages ?? []) as SqsMessage[]) {
      if (!message.Body || !message.ReceiptHandle) continue;
      try {
        const event = JSON.parse(message.Body) as InboxEvent & { data?: Record<string, unknown> };
        await this.consumeInbox.execute({
          eventId: event.eventId ?? message.MessageId ?? message.ReceiptHandle,
          eventType: event.eventType,
          payload: event.data ?? event.payload,
        });
        await this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }));
        processed += 1;
      } catch (error) {
        logStructured('error', 'inbox_message_failed', {
          messageId: message.MessageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return processed;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.pollOnce().catch(() => undefined); }, 1000);
  }

  public onModuleInit(): void { this.start(); }

  public onModuleDestroy(): void { this.stop(); }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
