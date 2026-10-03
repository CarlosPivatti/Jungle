import { WalletUnitOfWork } from '../ports/wallet-unit-of-work.port.js';
import { Money } from '../../domain/value-objects/money.vo.js';
import { randomUUID } from 'node:crypto';

export type WagerKind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

export interface ProcessWagerInput {
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerKind;
  money: { amount: string; currency: string };
}

export interface ProcessWagerOutput {
  transactionId: string;
  status: 'PROCESSED';
  balance: { amount: string; currency: string };
  idempotentReplay: boolean;
}

export class ProcessWagerUseCase {
  public constructor(private readonly unitOfWork: WalletUnitOfWork) {}

  public async execute(input: ProcessWagerInput): Promise<ProcessWagerOutput> {
    return this.unitOfWork.transactional(async (context) => {
      const existing = await context.findTransactionByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        if (existing.payloadHash !== input.payloadHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        return {
          transactionId: existing.id,
          status: existing.status,
          balance: existing.balance,
          idempotentReplay: true,
        };
      }

      const wallet = await context.findWalletForUpdate(input.walletId);
      if (!wallet) throw new Error('WALLET_NOT_FOUND');

      // The first lookup avoids unnecessary locking; this one closes the concurrent replay window.
      const transactionAfterLock = await context.findTransactionByIdempotencyKey(input.idempotencyKey);
      if (transactionAfterLock) {
        if (transactionAfterLock.payloadHash !== input.payloadHash) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        return {
          transactionId: transactionAfterLock.id,
          status: transactionAfterLock.status,
          balance: transactionAfterLock.balance,
          idempotentReplay: true,
        };
      }

      const amount = Money.from(input.money);
      switch (input.kind) {
        case 'BET':
        case 'LOSS':
          wallet.debit(amount);
          break;
        case 'WIN':
        case 'REFUND':
        case 'ROLLBACK':
          wallet.credit(amount);
          break;
      }

      const transactionId = randomUUID();
      const balance = wallet.balance.toJSON();
      await context.saveWallet(wallet);
      await context.saveTransaction({ id: transactionId, externalTransactionId: input.externalTransactionId, idempotencyKey: input.idempotencyKey, payloadHash: input.payloadHash, status: 'PROCESSED', balance });
      await context.appendLedgerEntry({ transactionId, walletId: wallet.id, amount: input.money.amount, currency: amount.currency, kind: input.kind });
      await context.enqueueOutbox({ transactionId, walletId: wallet.id, kind: input.kind });

      return { transactionId, status: 'PROCESSED', balance, idempotentReplay: false };
    });
  }
}
