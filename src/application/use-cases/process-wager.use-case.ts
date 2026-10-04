import { WalletUnitOfWork, type StoredTransaction } from '../ports/wallet-unit-of-work.port.js';
import { Money } from '../../domain/value-objects/money.vo.js';
import { randomUUID } from 'node:crypto';
import type { MetricsRegistry } from '../../infrastructure/observability/metrics.registry.js';

export type WagerKind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

export interface ProcessWagerInput {
  providerId?: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerKind;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}

export interface ProcessWagerOutput {
  transactionId: string;
  status: 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';
  balance: { amount: string; currency: string };
  idempotentReplay: boolean;
}

export class ProcessWagerUseCase {
  public constructor(
    private readonly unitOfWork: WalletUnitOfWork,
    private readonly metrics?: MetricsRegistry,
  ) {}

  public async execute(input: ProcessWagerInput): Promise<ProcessWagerOutput> {
    return this.unitOfWork.transactional(async (context) => {
      const providerId = input.providerId ?? 'default-provider';
      const existing = await context.findTransactionByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        if (existing.payloadHash !== input.payloadHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        if (existing.status !== 'PENDING_REFERENCE') {
          this.metrics?.increment('wager_duplicates_total');
          return {
            transactionId: existing.id,
            status: existing.status,
            balance: existing.balance,
            idempotentReplay: true,
          };
        }
      }

      const wallet = await context.findWalletForUpdate(input.walletId);
      if (!wallet) throw new Error('WALLET_NOT_FOUND');

      // The first lookup avoids unnecessary locking; this one closes the concurrent replay window.
      const transactionAfterLock = await context.findTransactionByIdempotencyKey(input.idempotencyKey);
      if (transactionAfterLock) {
        if (transactionAfterLock.payloadHash !== input.payloadHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        if (transactionAfterLock.status !== 'PENDING_REFERENCE') {
          return {
            transactionId: transactionAfterLock.id,
            status: transactionAfterLock.status,
            balance: transactionAfterLock.balance,
            idempotentReplay: true,
          };
        }
      }

      const amount = Money.from(input.money);
      const requiresReference = input.kind === 'REFUND' || input.kind === 'ROLLBACK';
      if (requiresReference && !input.referenceExternalTransactionId) {
        throw new Error('REFERENCE_REQUIRED');
      }

      const reference = input.referenceExternalTransactionId
        ? await context.findTransactionByExternalReference?.(providerId, input.referenceExternalTransactionId)
        : undefined;
      if (requiresReference && !reference) {
        if (transactionAfterLock) {
          return {
            transactionId: transactionAfterLock.id,
            status: transactionAfterLock.status,
            balance: transactionAfterLock.balance,
            idempotentReplay: true,
          };
        }
        const pendingId = randomUUID();
        const pendingBalance = wallet.balance.toJSON();
        await context.saveTransaction({
          id: pendingId,
          providerId,
          externalTransactionId: input.externalTransactionId,
          idempotencyKey: input.idempotencyKey,
          payloadHash: input.payloadHash,
          walletId: input.walletId,
          playerId: wallet.playerId,
          roundId: input.roundId,
          gameId: input.gameId,
          kind: input.kind,
          money: input.money,
          referenceExternalTransactionId: input.referenceExternalTransactionId,
          status: 'PENDING_REFERENCE',
          balance: pendingBalance,
        });
        return { transactionId: pendingId, status: 'PENDING_REFERENCE', balance: pendingBalance, idempotentReplay: false };
      }
      if (reference) {
        if (reference.walletId !== input.walletId || reference.roundId !== input.roundId || reference.gameId !== input.gameId
          || reference.money.currency !== amount.currency) {
          throw new Error('INVALID_REFERENCE');
        }
        if (input.kind === 'REFUND' && reference.kind !== 'BET') throw new Error('INVALID_REFERENCE');
        if (input.kind === 'ROLLBACK' && !['BET', 'WIN', 'REFUND'].includes(reference.kind)) {
          throw new Error('INVALID_REFERENCE');
        }
        if (reference.money.amount !== amount.toJSON().amount) throw new Error('REFERENCE_AMOUNT_MISMATCH');
      }

      const balanceBefore = wallet.balance.toJSON();
      const rollbackDebit = input.kind === 'ROLLBACK'
        && reference !== undefined
        && ['WIN', 'REFUND'].includes(reference.kind);
      switch (input.kind) {
        case 'BET':
          wallet.debit(amount);
          break;
        case 'WIN':
        case 'REFUND':
          wallet.credit(amount);
          break;
        case 'ROLLBACK':
          if (rollbackDebit) wallet.debit(amount);
          else wallet.credit(amount);
          break;
        case 'LOSS':
          break;
      }

      const transactionId = transactionAfterLock?.id ?? randomUUID();
      const balance = wallet.balance.toJSON();
      await context.saveWallet(wallet);
      const transaction: StoredTransaction = {
        id: transactionId,
        providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
        walletId: input.walletId,
        playerId: wallet.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money: input.money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
        status: 'PROCESSED',
        balance,
      };
      if (transactionAfterLock && context.updateTransaction) {
        await context.updateTransaction(transaction);
      } else {
        await context.saveTransaction(transaction);
      }
      await context.appendLedgerEntry({
        transactionId,
        walletId: wallet.id,
        amount: input.kind === 'LOSS' ? '0.00' : input.money.amount,
        currency: amount.currency,
        kind: input.kind,
        balanceBefore,
        balanceAfter: balance,
      });
      await context.enqueueOutbox({ transactionId, walletId: wallet.id, kind: input.kind });

      return { transactionId, status: 'PROCESSED', balance, idempotentReplay: false };
    });
  }
}
