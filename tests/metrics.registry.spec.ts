import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../src/infrastructure/observability/metrics.registry.js';

describe('MetricsRegistry', () => {
  it('renders counters and observations with deterministic labels', () => {
    const metrics = new MetricsRegistry();
    metrics.increment('wager_transactions_total', { kind: 'BET', status: 'PROCESSED' });
    metrics.observe('wager_processing_duration_seconds', 0.25, { kind: 'BET' });

    expect(metrics.prometheus()).toContain('wager_transactions_total{kind="BET",status="PROCESSED"} 1');
    expect(metrics.prometheus()).toContain('wager_processing_duration_seconds_sum{kind="BET"} 0.25');
    expect(metrics.prometheus()).toContain('wager_processing_duration_seconds_count{kind="BET"} 1');
  });
});
