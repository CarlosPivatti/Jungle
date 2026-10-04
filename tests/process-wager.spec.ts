import { describe, expect, it } from 'vitest';
import { Wallet } from '../src/domain/entities/wallet.entity.js';
import { ProcessWagerUseCase } from '../src/application/use-cases/process-wager.use-case.js';
import type { StoredTransaction, WalletTransactionContext, WalletUnitOfWork } from '../src/application/ports/wallet-unit-of-work.port.js';
import { Money } from '../src/domain/value-objects/money.vo.js';

function createHarness() {
  const wallet = Wallet.open({ id: 'wallet-1', playerId: 'player-1', initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }) });
  const transactions: StoredTransaction[] = [];
  const ledger: unknown[] = [];
  const outbox: unknown[] = [];
  const context: WalletTransactionContext = {
    findTransactionByIdempotencyKey: async (key) => transactions.find((item) => item.idempotencyKey === key),
    findWalletForUpdate: async () => wallet,
    saveWallet: async () => undefined,
    saveTransaction: async (transaction) => { transactions.push(transaction); },
    appendLedgerEntry: async (entry) => { ledger.push(entry); },
    enqueueOutbox: async (event) => { outbox.push(event); },
  };
  const unitOfWork: WalletUnitOfWork = { transactional: async (work) => work(context) };
  return { wallet, transactions, ledger, outbox, useCase: new ProcessWagerUseCase(unitOfWork) };
}

const input = {
  externalTransactionId: 'tx-1', idempotencyKey: 'idem-1', payloadHash: 'hash-1', walletId: 'wallet-1',
  roundId: 'round-1', gameId: 'game-1', kind: 'BET' as const, money: { amount: '12.50', currency: 'BRL' },
};

describe('ProcessWagerUseCase', () => {
  it('updates wallet and writes ledger plus outbox atomically through the port', async () => {
    const harness = createHarness();
    const result = await harness.useCase.execute(input);

    expect(result.status).toBe('PROCESSED');
    expect(result.transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.balance).toEqual({ amount: '87.50', currency: 'BRL' });
    expect(harness.ledger).toHaveLength(1);
    expect(harness.outbox).toHaveLength(1);
  });

  it('returns a replay without changing the balance', async () => {
    const harness = createHarness();
    await harness.useCase.execute(input);
    const replay = await harness.useCase.execute(input);

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.balance.amount).toBe('87.50');
    expect(harness.wallet.balance.toJSON().amount).toBe('87.50');
    expect(harness.transactions).toHaveLength(1);
  });

  it('rejects the same idempotency key with a different payload', async () => {
    const harness = createHarness();
    await harness.useCase.execute(input);
    await expect(harness.useCase.execute({ ...input, payloadHash: 'different' })).rejects.toThrow('IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  it('records LOSS without changing the wallet balance', async () => {
    const harness = createHarness();
    const result = await harness.useCase.execute({ ...input, kind: 'LOSS' });

    expect(result.balance.amount).toBe('100.00');
    expect(harness.wallet.balance.toJSON().amount).toBe('100.00');
    expect(harness.ledger).toEqual([expect.objectContaining({
      kind: 'LOSS',
      amount: '0.00',
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '100.00', currency: 'BRL' },
    })]);
  });
});
