import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money.vo.js';
import { Wallet } from '../src/domain/entities/wallet.entity.js';

describe('Money', () => {
  it('sums decimal values without floating point drift', () => {
    const result = Money.from({ amount: '0.10', currency: 'BRL' }).add(Money.from({ amount: '0.20', currency: 'BRL' }));
    expect(result.toJSON()).toEqual({ amount: '0.30', currency: 'BRL' });
  });

  it('rejects more than two decimal places', () => {
    expect(() => Money.from({ amount: '1.001', currency: 'BRL' })).toThrow('Invalid decimal format');
  });
});

describe('Wallet', () => {
  it('debits and increments its version', () => {
    const wallet = Wallet.open({ id: 'wallet-1', playerId: 'player-1', initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }) });
    wallet.debit(Money.from({ amount: '3.25', currency: 'BRL' }));
    expect(wallet.balance.toJSON()).toEqual({ amount: '6.75', currency: 'BRL' });
    expect(wallet.version).toBe(2);
  });

  it('does not allow overdraft', () => {
    const wallet = Wallet.open({ id: 'wallet-1', playerId: 'player-1', initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }) });
    expect(() => wallet.debit(Money.from({ amount: '10.01', currency: 'BRL' }))).toThrow('INSUFFICIENT_FUNDS');
  });
});
