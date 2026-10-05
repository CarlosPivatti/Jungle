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
    findTransactionByExternalReference: async (_providerId, externalId) =>
      transactions.find((item) => item.externalTransactionId === externalId),
    saveWallet: async () => undefined,
    saveTransaction: async (transaction) => {
      if (transaction.referenceExternalTransactionId && transactions.some((item) =>
        item.providerId === transaction.providerId &&
        item.referenceExternalTransactionId === transaction.referenceExternalTransactionId &&
        item.kind === transaction.kind)) {
        throw new Error('DUPLICATE_REFERENCE_OPERATION');
      }
      transactions.push(transaction);
    },
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
    expect(harness.ledger).toHaveLength(0);
  });

  it('persists an insufficient-funds bet as rejected without a ledger', async () => {
    const harness = createHarness();
    const result = await harness.useCase.execute({ ...input, money: { amount: '120.00', currency: 'BRL' } });

    expect(result.status).toBe('REJECTED');
    expect(harness.transactions[0]).toEqual(expect.objectContaining({
      status: 'REJECTED',
      failureCode: 'INSUFFICIENT_FUNDS',
    }));
    expect(harness.ledger).toHaveLength(0);
    expect(harness.outbox).toEqual([expect.objectContaining({ status: 'REJECTED' })]);
  });

  it('persists invalid references as rejected', async () => {
    const rejected = {
      id: 'rejected-reference',
      providerId: 'default-provider',
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      walletId: input.walletId,
      playerId: 'player-1',
      roundId: input.roundId,
      gameId: input.gameId,
      kind: 'REFUND',
      money: input.money,
      status: 'REJECTED' as const,
      failureCode: 'REFERENCE_AMOUNT_MISMATCH',
      balance: { amount: '100.00', currency: 'BRL' },
    };
    const useCase = new ProcessWagerUseCase({
      transactional: async () => { throw new Error('REFERENCE_AMOUNT_MISMATCH'); },
      recordRejectedTransaction: async () => rejected,
    });

    await expect(useCase.execute({ ...input, kind: 'REFUND' })).resolves.toMatchObject({
      status: 'REJECTED',
      failureCode: 'REFERENCE_AMOUNT_MISMATCH',
    });
  });

  it('returns a persisted FAILED transaction for an unexpected technical error', async () => {
    const harness = createHarness();
    const failed = {
      id: 'failed-transaction',
      providerId: 'default-provider',
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      walletId: input.walletId,
      playerId: 'player-1',
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      status: 'FAILED' as const,
      failureCode: 'OUTBOX_UNAVAILABLE',
      balance: { amount: '100.00', currency: 'BRL' },
    };
    harness.useCase = new ProcessWagerUseCase({
      transactional: async () => { throw new Error('OUTBOX_UNAVAILABLE'); },
      recordFailedTransaction: async () => failed,
    });

    const result = await harness.useCase.execute(input);

    expect(result).toEqual({
      transactionId: 'failed-transaction',
      status: 'FAILED',
      failureCode: 'OUTBOX_UNAVAILABLE',
      balance: { amount: '100.00', currency: 'BRL' },
      idempotentReplay: false,
    });
  });

  it('processes BET refunds and rollbacks with the correct balance direction', async () => {
      const harness = createHarness();
      const bet = await harness.useCase.execute(input);
      const refund = await harness.useCase.execute({
        ...input,
        externalTransactionId: 'refund-1',
        idempotencyKey: 'idem-refund-1',
        kind: 'REFUND',
        referenceExternalTransactionId: input.externalTransactionId,
      });
      expect(refund.balance.amount).toBe('100.00');

      await harness.useCase.execute({
        ...input,
        externalTransactionId: 'win-1',
        idempotencyKey: 'idem-win-1',
        kind: 'WIN',
      });
      const rollback = await harness.useCase.execute({
        ...input,
        externalTransactionId: 'rollback-win-1',
        idempotencyKey: 'idem-rollback-win-1',
        kind: 'ROLLBACK',
        referenceExternalTransactionId: 'win-1',
      });
      expect(rollback.balance.amount).toBe('100.00');
      expect(bet.status).toBe('PROCESSED');
  });
});
