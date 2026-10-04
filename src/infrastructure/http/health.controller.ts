import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { logStructured } from '../observability/structured-logger.js';

@Controller()
export class HealthController {
  public constructor(
    @Inject(Pool) private readonly pool: Pool,
    @Inject(SQSClient) private readonly sqs: SQSClient,
  ) {}

  @Get('healthz')
  public health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('health/live')
  public live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  public async readiness(): Promise<{ status: 'ok'; database: 'ok'; sqs: 'ok' }> {
    let database: 'ok' | 'unavailable' = 'ok';
    let sqs: 'ok' | 'unavailable' = 'ok';
    try {
      await this.pool.query('SELECT 1');
    } catch (error) {
      database = 'unavailable';
      logStructured('error', 'database_readiness_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      await this.sqs.send(new GetQueueAttributesCommand({
        QueueUrl: process.env.SQS_QUEUE_URL ?? 'http://localhost:4566/000000000000/wager-events',
        AttributeNames: ['ApproximateNumberOfMessages'],
      }));
    } catch (error) {
      sqs = 'unavailable';
      logStructured('error', 'sqs_readiness_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (database !== 'ok' || sqs !== 'ok') {
      throw new ServiceUnavailableException({ status: 'unavailable', database, sqs });
    }
    return { status: 'ok', database: 'ok', sqs: 'ok' };
  }

  @Get('health/ready')
  public async ready(): Promise<{ status: 'ok'; database: 'ok'; sqs: 'ok' }> {
    return this.readiness();
  }
}
