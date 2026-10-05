import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsRegistry {
  private readonly values = new Map<string, number>();

  public increment(name: string, labelsOrAmount: Record<string, string> | number = 1, amount = 1): void {
    const labels = typeof labelsOrAmount === 'number' ? undefined : labelsOrAmount;
    const value = typeof labelsOrAmount === 'number' ? labelsOrAmount : amount;
    const key = labels ? `${name}{${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${v}"`).join(',')}}` : name;
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  public observe(name: string, value: number, labels?: Record<string, string>): void {
    this.increment(`${name}_sum`, labels, value);
    this.increment(`${name}_count`, labels);
  }

  public snapshot(): Record<string, number> {
    return Object.fromEntries(this.values);
  }

  public prometheus(): string {
    return [...this.values.entries()]
      .map(([name, value]) => `${name} ${value}`)
      .join('\n');
  }
}
