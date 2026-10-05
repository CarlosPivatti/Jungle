import { DataSource } from 'typeorm';
import { ProcessWagerUseCase } from '../../src/application/use-cases/process-wager.use-case.js';
import { PostgresWalletUnitOfWork } from '../../src/infrastructure/database/postgres-wallet-unit-of-work.js';

const [walletId, externalTransactionId, idempotencyKey] = process.argv.slice(2);
if (!walletId || !externalTransactionId || !idempotencyKey) throw new Error('INVALID_PROCESS_ARGUMENTS');

const dataSource = await new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/jungle',
  entities: [],
  migrations: [],
}).initialize();

try {
  const result = await new ProcessWagerUseCase(new PostgresWalletUnitOfWork(dataSource)).execute({
    externalTransactionId,
    idempotencyKey,
    payloadHash: idempotencyKey,
    walletId,
    roundId: `process-round-${idempotencyKey}`,
    gameId: 'process-game',
    kind: 'BET',
    money: { amount: '1.00', currency: 'BRL' },
  });
  process.stdout.write(JSON.stringify(result));
} finally {
  await dataSource.destroy();
}
