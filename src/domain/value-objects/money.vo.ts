import { Decimal } from 'decimal.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  public static from({ amount, currency }: MoneyProps): Money {
    if (!currency?.trim()) throw new Error('Currency is required');
    if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) {
      throw new Error(`Invalid decimal format for Money: ${amount}`);
    }

    return new Money(new Decimal(amount), currency.toUpperCase());
  }

  public static zero(currency = 'BRL'): Money {
    return Money.from({ amount: '0.00', currency });
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.from({ amount: this.value.plus(other.value).toFixed(2), currency: this.currency });
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.from({ amount: this.value.minus(other.value).toFixed(2), currency: this.currency });
  }

  public isPositive(): boolean { return this.value.isPositive(); }
  public isLessThan(other: Money): boolean { this.assertSameCurrency(other); return this.value.lessThan(other.value); }
  public equals(other: Money): boolean { return this.currency === other.currency && this.value.equals(other.value); }
  public toJSON(): MoneyProps { return { amount: this.value.toFixed(2), currency: this.currency }; }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
  }
}
