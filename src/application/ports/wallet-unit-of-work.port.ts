import { Wallet } from '../../domain/entities/wallet.entity.js';

export interface StoredTransaction {
  id: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  status: 'PROCESSED';
  balance: { amount: string; currency: string };
}

export interface WalletTransactionContext {
  findTransactionByIdempotencyKey(key: string): Promise<StoredTransaction | undefined>;
  findWalletForUpdate(walletId: string): Promise<Wallet | undefined>;
  saveWallet(wallet: Wallet): Promise<void>;
  saveTransaction(transaction: StoredTransaction): Promise<void>;
  appendLedgerEntry(entry: { transactionId: string; walletId: string; amount: string; currency: string; kind: string }): Promise<void>;
  enqueueOutbox(event: { transactionId: string; walletId: string; kind: string }): Promise<void>;
}

export interface WalletUnitOfWork {
  transactional<T>(work: (context: WalletTransactionContext) => Promise<T>): Promise<T>;
}
