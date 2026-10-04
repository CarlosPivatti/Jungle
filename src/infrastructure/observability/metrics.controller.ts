import { Controller, Get, Inject } from '@nestjs/common';
import { MetricsRegistry } from './metrics.registry.js';

@Controller()
export class MetricsController {
  public constructor(@Inject(MetricsRegistry) private readonly metrics: MetricsRegistry) {}

  @Get('metrics')
  public metricsEndpoint(): string {
    return this.metrics.prometheus();
  }
}
