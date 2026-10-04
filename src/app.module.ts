import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Pool } from 'pg';
import { ProcessWagerUseCase } from './application/use-cases/process-wager.use-case.js';
import { PostgresWalletUnitOfWork } from './infrastructure/database/postgres-wallet-unit-of-work.js';
import { ProcessWagerController } from './infrastructure/http/process-wager.controller.js';
import { PublishOutboxUseCase } from './application/use-cases/publish-outbox.use-case.js';
import { OutboxWorker } from './infrastructure/queue/outbox.worker.js';
import { PostgresOutboxRepository } from './infrastructure/database/postgres-outbox.repository.js';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SqsEventPublisher } from './infrastructure/queue/sqs-event.publisher.js';
import { HealthController } from './infrastructure/http/health.controller.js';
import { ApiKeyGuard } from './infrastructure/http/api-key.guard.js';
import { PostgresInboxRepository } from './infrastructure/database/postgres-inbox.repository.js';
import { ConsumeInboxUseCase } from './application/use-cases/consume-inbox.use-case.js';
import { WagerEventHandler } from './infrastructure/queue/wager-event.handler.js';
import { PendingReferenceWorker } from './infrastructure/queue/pending-reference.worker.js';
import { SqsInboxConsumer } from './infrastructure/queue/sqs-inbox.consumer.js';
import { WalletController } from './infrastructure/http/wallet.controller.js';
import { MetricsController } from './infrastructure/observability/metrics.controller.js';
import { MetricsRegistry } from './infrastructure/observability/metrics.registry.js';
import { DemoController } from './infrastructure/http/demo.controller.js';

@Module({
  controllers: [ProcessWagerController, HealthController, WalletController, MetricsController, DemoController],
  providers: [
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    MetricsRegistry,
    {
      provide: ProcessWagerUseCase,
      inject: [PostgresWalletUnitOfWork, MetricsRegistry],
      useFactory: (unitOfWork: PostgresWalletUnitOfWork, metrics: MetricsRegistry) => new ProcessWagerUseCase(unitOfWork, metrics),
    },
    {
      provide: Pool,
      useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://jungle:jungle@localhost:5432/jungle' }),
    },
    {
      provide: PostgresWalletUnitOfWork,
      inject: [Pool],
      useFactory: (pool: Pool) => new PostgresWalletUnitOfWork(pool),
    },
    {
      provide: SQSClient,
      useFactory: () => {
        const queueUrl = process.env.SQS_QUEUE_URL ?? 'http://localhost:4566/000000000000/wager-events';
        const endpoint = process.env.SQS_ENDPOINT ?? (queueUrl.startsWith('http://localhost:4566') ? 'http://localhost:4566' : undefined);
        return new SQSClient(endpoint
          ? { region: process.env.AWS_REGION ?? 'us-east-1', endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
          : { region: process.env.AWS_REGION ?? 'us-east-1' });
      },
    },
    {
      provide: SqsEventPublisher,
      inject: [SQSClient],
      useFactory: (client: SQSClient) => new SqsEventPublisher(
        client,
        process.env.SQS_QUEUE_URL ?? 'http://localhost:4566/000000000000/wager-events',
      ),
    },
    {
      provide: PostgresOutboxRepository,
      inject: [Pool],
      useFactory: (pool: Pool) => new PostgresOutboxRepository(pool),
    },
    {
      provide: PublishOutboxUseCase,
      inject: [PostgresOutboxRepository, SqsEventPublisher],
      useFactory: (repository: PostgresOutboxRepository, publisher: SqsEventPublisher) => new PublishOutboxUseCase(repository, publisher),
    },
    {
      provide: OutboxWorker,
      inject: [PublishOutboxUseCase],
      useFactory: (useCase: PublishOutboxUseCase) => new OutboxWorker(useCase),
    },
    {
      provide: PendingReferenceWorker,
      inject: [Pool, ProcessWagerUseCase],
      useFactory: (pool: Pool, useCase: ProcessWagerUseCase) => new PendingReferenceWorker(pool, useCase),
    },
    {
      provide: PostgresInboxRepository,
      inject: [Pool],
      useFactory: (pool: Pool) => new PostgresInboxRepository(pool),
    },
    {
      provide: ConsumeInboxUseCase,
      inject: [PostgresInboxRepository, WagerEventHandler],
      useFactory: (repository: PostgresInboxRepository, handler: WagerEventHandler) => new ConsumeInboxUseCase(repository, handler),
    },
    {
      provide: WagerEventHandler,
      inject: [MetricsRegistry],
      useFactory: (metrics: MetricsRegistry) => new WagerEventHandler(metrics),
    },
    {
      provide: SqsInboxConsumer,
      inject: [SQSClient, ConsumeInboxUseCase],
      useFactory: (client: SQSClient, consumeInbox: ConsumeInboxUseCase) => new SqsInboxConsumer(
        client,
        process.env.SQS_QUEUE_URL ?? 'http://localhost:4566/000000000000/wager-events',
        consumeInbox,
      ),
    },
  ],
})
export class AppModule {}
