import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DataSource } from 'typeorm';
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
      provide: PostgresWalletUnitOfWork,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new PostgresWalletUnitOfWork(dataSource),
    },
    {
      provide: DataSource,
      useFactory: async () => {
        const dataSource = new DataSource({
          type: 'postgres',
          url: process.env.DATABASE_URL ?? 'postgresql://jungle:jungle@localhost:5432/jungle',
          entities: [],
          migrations: [],
        });
        return dataSource.initialize();
      },
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
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new PostgresOutboxRepository(dataSource),
    },
    {
      provide: PublishOutboxUseCase,
      inject: [PostgresOutboxRepository, SqsEventPublisher, MetricsRegistry],
      useFactory: (repository: PostgresOutboxRepository, publisher: SqsEventPublisher, metrics: MetricsRegistry) =>
        new PublishOutboxUseCase(repository, publisher, 50, metrics),
    },
    {
      provide: OutboxWorker,
      inject: [PublishOutboxUseCase],
      useFactory: (useCase: PublishOutboxUseCase) => new OutboxWorker(useCase),
    },
    {
      provide: PendingReferenceWorker,
      inject: [DataSource, ProcessWagerUseCase, MetricsRegistry],
      useFactory: (dataSource: DataSource, useCase: ProcessWagerUseCase, metrics: MetricsRegistry) => new PendingReferenceWorker(dataSource, useCase, metrics),
    },
    {
      provide: PostgresInboxRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new PostgresInboxRepository(dataSource),
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
