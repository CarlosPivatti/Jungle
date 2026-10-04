import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { ProcessWagerUseCase } from '../../src/application/use-cases/process-wager.use-case.js';
import { PostgresWalletUnitOfWork } from '../../src/infrastructure/database/postgres-wallet-unit-of-work.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://jungle:jungle@localhost:5432/jungle' });
const walletId = randomUUID();
const playerId = randomUUID();

describe('financial concurrency', () => {
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO wallets (id, player_id, currency, balance)
       VALUES ($1, $2, 'BRL', 100.00)`,
      [walletId, playerId],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM outbox_messages WHERE wallet_id = $1', [walletId]);
    await pool.query('DELETE FROM wallet_ledger_entries WHERE wallet_id = $1', [walletId]);
    await pool.query('DELETE FROM wager_transactions WHERE wallet_id = $1', [walletId]);
    await pool.query('DELETE FROM wallets WHERE id = $1', [walletId]);
    await pool.end();
  });

  it('serializes 50 concurrent bets without lost updates', async () => {
    const useCase = new ProcessWagerUseCase(new PostgresWalletUnitOfWork(pool));
    const results = await Promise.all(Array.from({ length: 50 }, (_, index) => useCase.execute({
      externalTransactionId: randomUUID(),
      idempotencyKey: `concurrency-${walletId}-${index}`,
      payloadHash: `hash-${index}`,
      walletId,
      roundId: `round-${index}`,
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '1.00', currency: 'BRL' },
    })));

    const balance = await pool.query<{ balance: string; version: number }>(
      'SELECT balance, version FROM wallets WHERE id = $1', [walletId],
    );
    const counts = await pool.query<{ ledger: string; outbox: string; transactions: string }>(
      `SELECT
         (SELECT COUNT(*) FROM wallet_ledger_entries WHERE wallet_id = $1) AS ledger,
         (SELECT COUNT(*) FROM outbox_messages WHERE wallet_id = $1) AS outbox,
         (SELECT COUNT(*) FROM wager_transactions WHERE wallet_id = $1) AS transactions`,
      [walletId],
    );

    expect(results).toHaveLength(50);
    expect(balance.rows[0]).toEqual({ balance: '50.00', version: 51 });
    expect(counts.rows[0]).toEqual({ ledger: '50', outbox: '100', transactions: '50' });
  }, 15_000);

  it('replays simultaneous requests with the same idempotency key', async () => {
    const useCase = new ProcessWagerUseCase(new PostgresWalletUnitOfWork(pool));
    const request = {
      externalTransactionId: randomUUID(),
      idempotencyKey: `duplicate-${walletId}`,
      payloadHash: 'same-payload',
      walletId,
      roundId: 'round-duplicate',
      gameId: 'game-1',
      kind: 'BET' as const,
      money: { amount: '1.00', currency: 'BRL' },
    };

    const results = await Promise.all(Array.from({ length: 10 }, () => useCase.execute(request)));
    const transactions = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM wager_transactions WHERE wallet_id = $1', [walletId],
    );
    const balance = await pool.query<{ balance: string }>('SELECT balance FROM wallets WHERE id = $1', [walletId]);

    expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
    expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
    expect(transactions.rows[0]?.count).toBe('51');
    expect(balance.rows[0]?.balance).toBe('49.00');
  }, 15_000);

  it('replays fifty simultaneous duplicates as one financial operation', async () => {
    const useCase = new ProcessWagerUseCase(new PostgresWalletUnitOfWork(pool));
    const request = {
      externalTransactionId: randomUUID(),
      idempotencyKey: `fifty-duplicate-${walletId}`,
      payloadHash: 'fifty-same-payload',
      walletId,
      roundId: 'round-fifty-duplicate',
      gameId: 'game-1',
      kind: 'BET' as const,
      money: { amount: '1.00', currency: 'BRL' },
    };

    const results = await Promise.all(Array.from({ length: 50 }, () => useCase.execute(request)));
    expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
    expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
  }, 15_000);

  it('serializes work across three independent pool instances', async () => {
    const pools = [new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://jungle:jungle@localhost:5432/jungle' }),
      new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://jungle:jungle@localhost:5432/jungle' }),
      new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://jungle:jungle@localhost:5432/jungle' })];
    try {
      const localWalletId = randomUUID();
      const localPlayerId = randomUUID();
      await pool.query(
        `INSERT INTO wallets (id, player_id, currency, balance) VALUES ($1, $2, 'BRL', 3.00)`,
        [localWalletId, localPlayerId],
      );
      const results = await Promise.all(pools.map((instance, index) => new ProcessWagerUseCase(
        new PostgresWalletUnitOfWork(instance),
      ).execute({
        externalTransactionId: randomUUID(),
        idempotencyKey: `three-process-${localWalletId}-${index}`,
        payloadHash: `three-process-hash-${index}`,
        walletId: localWalletId,
        roundId: `round-three-${index}`,
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '1.00', currency: 'BRL' },
      })));
      expect(results).toHaveLength(3);
      const balance = await pool.query('SELECT balance FROM wallets WHERE id = $1', [localWalletId]);
      expect(balance.rows[0]?.balance).toBe('0.00');
      await pool.query('DELETE FROM outbox_messages WHERE wallet_id = $1', [localWalletId]);
      await pool.query('DELETE FROM wallet_ledger_entries WHERE wallet_id = $1', [localWalletId]);
      await pool.query('DELETE FROM wager_transactions WHERE wallet_id = $1', [localWalletId]);
      await pool.query('DELETE FROM wallets WHERE id = $1', [localWalletId]);
    } finally {
      await Promise.all(pools.map((instance) => instance.end()));
    }
  }, 15_000);
});