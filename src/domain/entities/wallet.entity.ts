import { Money } from '../value-objects/money.vo.js';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private currentBalance: Money,
    private currentVersion: number,
    public readonly createdAt: Date,
    private lastUpdatedAt: Date,
  ) {}

  public static open(props: { id: string; playerId: string; initialBalance: Money }): Wallet {
    const now = new Date();
    return new Wallet(props.id, props.playerId, props.initialBalance.currency, props.initialBalance, 1, now, now);
  }

  public static rehydrate(state: WalletState): Wallet {
    return new Wallet(state.id, state.playerId, state.currency, state.balance, state.version, state.createdAt, state.updatedAt);
  }

  public get balance(): Money { return this.currentBalance; }
  public get version(): number { return this.currentVersion; }
  public get updatedAt(): Date { return this.lastUpdatedAt; }

  public debit(amount: Money): void {
    this.assertValidAmount(amount);
    if (this.currentBalance.isLessThan(amount)) throw new Error('INSUFFICIENT_FUNDS');
    this.currentBalance = this.currentBalance.subtract(amount);
    this.bumpVersion();
  }

  public credit(amount: Money): void {
    this.assertValidAmount(amount);
    this.currentBalance = this.currentBalance.add(amount);
    this.bumpVersion();
  }

  private assertValidAmount(amount: Money): void {
    if (amount.currency !== this.currency) throw new Error(`Wallet currency mismatch: ${this.currency} vs ${amount.currency}`);
    if (!amount.isPositive()) throw new Error('Operation amount must be positive');
  }

  private bumpVersion(): void {
    this.currentVersion += 1;
    this.lastUpdatedAt = new Date();
  }
}
