import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';

@Controller()
export class HealthController {
  public constructor(private readonly pool: Pool) {}

  @Get('healthz')
  public health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  public async readiness(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'unavailable' });
    }
  }
}
