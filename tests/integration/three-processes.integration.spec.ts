import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const execFileAsync = promisify(execFile);
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/jungle' });
const walletId = randomUUID();

describe('real process concurrency', () => {
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO wallets (id, player_id, currency, balance) VALUES ($1, $2, 'BRL', 3.00)`,
      [walletId, randomUUID()],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM outbox_messages WHERE wallet_id = $1', [walletId]);
    await pool.query('DELETE FROM wallet_ledger_entries WHERE wallet_id = $1', [walletId]);
    await pool.query('DELETE FROM wager_transactions WHERE wallet_id = $1', [walletId]);
    await pool.query('DELETE FROM wallets WHERE id = $1', [walletId]);
    await pool.end();
  });

  it('serializes three independent Node processes', async () => {
    const script = 'tests/integration/process-worker.ts';
    const children = Array.from({ length: 3 }, (_, index) => execFileAsync(
      process.execPath,
      ['--import', 'tsx', script, walletId, randomUUID(), `process-${walletId}-${index}`],
      { env: process.env },
    ));
    const results = await Promise.all(children);
    expect(results).toHaveLength(3);
    const balance = await pool.query('SELECT balance FROM wallets WHERE id = $1', [walletId]);
    expect(balance.rows[0]?.balance).toBe('0.00');
  }, 30_000);
});
