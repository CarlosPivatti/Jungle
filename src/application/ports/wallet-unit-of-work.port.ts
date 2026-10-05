import { Wallet } from '../../domain/entities/wallet.entity.js';

export type WagerStatus = 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';

export interface StoredTransaction {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string | undefined;
  status: WagerStatus;
  failureCode?: string | undefined;
  balance: { amount: string; currency: string };
}

export interface WalletTransactionContext {
  findTransactionByIdempotencyKey(key: string): Promise<StoredTransaction | undefined>;
  findTransactionByExternalReference?(providerId: string, externalTransactionId: string): Promise<StoredTransaction | undefined>;
  findWalletForUpdate(walletId: string): Promise<Wallet | undefined>;
  saveWallet(wallet: Wallet): Promise<void>;
  saveTransaction(transaction: StoredTransaction): Promise<void>;
  updateTransaction?(transaction: StoredTransaction): Promise<void>;
  appendLedgerEntry(entry: {
    transactionId: string;
    walletId: string;
    amount: string;
    currency: string;
    kind: string;
    balanceBefore: { amount: string; currency: string };
    balanceAfter: { amount: string; currency: string };
  }): Promise<void>;
  enqueueOutbox(event: {
    transactionId: string;
    walletId: string;
    kind: string;
    status: WagerStatus;
  }): Promise<void>;
}

export interface WalletUnitOfWork {
  transactional<T>(work: (context: WalletTransactionContext) => Promise<T>): Promise<T>;
  recordFailedTransaction?(input: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
    failureCode: string;
  }): Promise<StoredTransaction>;
  recordRejectedTransaction?(input: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
    failureCode: string;
  }): Promise<StoredTransaction>;
}
