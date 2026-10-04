import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsRegistry {
  private readonly values = new Map<string, number>();

  public increment(name: string): void {
    this.values.set(name, (this.values.get(name) ?? 0) + 1);
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
