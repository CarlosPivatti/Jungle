import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, Matches, validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DataSource, type QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';

class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  public playerId!: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  public currency!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  public initialBalance?: string;
}

@Controller()
export class WalletController {
  public constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  @Post('wallets')
  public async createWallet(@Body() body: CreateWalletDto) {
    const dto = plainToInstance(CreateWalletDto, body);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) throw new BadRequestException(errors);
    const client: QueryRunner = this.dataSource.createQueryRunner();
    await client.connect();
    try {
      await client.startTransaction();
      const walletResult = await client.query(
        `INSERT INTO wallets (id, player_id, currency, balance)
         VALUES (gen_random_uuid(), $1, UPPER($2), $3)
         RETURNING id, player_id, currency, balance::text`,
        [dto.playerId, dto.currency, dto.initialBalance ?? '0.00'],
      );
      const wallet = walletResult[0] as { id: string; player_id: string; currency: string; balance: string } | undefined;
      if (!wallet) throw new BadRequestException('WALLET_NOT_CREATED');
      const opening = await client.query(
        `INSERT INTO wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id,
          round_id, game_id, kind, money_amount, money_currency, status, balance_amount, balance_currency)
         VALUES (gen_random_uuid(), 'system', $1, $2, $3, $4, $5, 'opening', 'system', 'OPENING',
                 $6, $7, 'PROCESSED', $6, $7)
         RETURNING id`,
        [
          `opening:${wallet.id}`,
          `opening:${wallet.id}`,
          'wallet-opening-v1',
          wallet.id,
          wallet.player_id,
          dto.initialBalance ?? '0.00',
          wallet.currency.trim(),
        ],
      );
      const openingTransaction = opening[0] as { id: string } | undefined;
      if (!openingTransaction) throw new BadRequestException('OPENING_NOT_CREATED');
      await client.query(
        `INSERT INTO wallet_ledger_entries
         (transaction_id, wallet_id, amount, currency, kind, balance_before, balance_after)
         VALUES ($1, $2, $3, $4, 'CREDIT', 0, $3)`,
        [openingTransaction.id, wallet.id, dto.initialBalance ?? '0.00', wallet.currency.trim()],
      );
      const payload = {
        eventId: randomUUID(),
        eventType: 'WalletBalanceChanged',
        aggregateId: wallet.id,
        correlationId: openingTransaction.id,
        causationId: openingTransaction.id,
        occurredAt: new Date().toISOString(),
        version: 1,
        data: { transactionId: openingTransaction.id, walletId: wallet.id, kind: 'OPENING', status: 'PROCESSED' },
      };
      await client.query(
        `INSERT INTO outbox_messages (transaction_id, wallet_id, event_type, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [openingTransaction.id, wallet.id, payload.eventType, JSON.stringify(payload)],
      );
      await client.commitTransaction();
      return { id: wallet.id, playerId: wallet.player_id, currency: wallet.currency.trim(), balance: wallet.balance };
    } catch (error) {
      await client.rollbackTransaction();
      throw error;
    } finally {
      await client.release();
    }
  }

  @Get('wallets/:walletId')
  public async getWallet(@Param('walletId') walletId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, player_id AS "playerId", currency, balance::text, version,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM wallets WHERE id = $1`,
      [walletId],
    );
    if (!rows[0]) throw new NotFoundException('WALLET_NOT_FOUND');
    return rows[0];
  }

  @Get('wallets/:walletId/ledger')
  public async getLedger(@Param('walletId') walletId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, transaction_id AS "transactionId", amount::text, currency, kind,
              balance_before::text AS "balanceBefore", balance_after::text AS "balanceAfter",
              created_at AS "createdAt"
       FROM wallet_ledger_entries WHERE wallet_id = $1 ORDER BY id`,
      [walletId],
    );
    return { walletId, entries: rows };
  }

  @Get('wagering/transactions/:transactionId')
  public async getTransaction(@Param('transactionId') transactionId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, provider_id AS "providerId", external_transaction_id AS "externalTransactionId",
              idempotency_key AS "idempotencyKey", wallet_id AS "walletId", player_id AS "playerId",
              round_id AS "roundId", game_id AS "gameId", kind, money_amount::text AS "amount",
              money_currency AS currency, reference_external_transaction_id AS "referenceExternalTransactionId",
              status, failure_code AS "failureCode", balance_amount::text AS "balanceAmount", balance_currency AS "balanceCurrency",
              created_at AS "createdAt"
       FROM wager_transactions WHERE id = $1`,
      [transactionId],
    );
    if (!rows[0]) throw new NotFoundException('TRANSACTION_NOT_FOUND');
    return rows[0];
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  public async getProviderTransaction(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    const rows = await this.dataSource.query(
      `SELECT id, provider_id AS "providerId", external_transaction_id AS "externalTransactionId",
              status, failure_code AS "failureCode", wallet_id AS "walletId", balance_amount::text AS "balanceAmount",
              balance_currency AS "balanceCurrency", created_at AS "createdAt"
       FROM wager_transactions WHERE provider_id = $1 AND external_transaction_id = $2`,
      [providerId, externalTransactionId],
    );
    if (!rows[0]) throw new NotFoundException('TRANSACTION_NOT_FOUND');
    return rows[0];
  }

  @Post('wallets/:walletId/reconciliation')
  public async reconcile(@Param('walletId') walletId: string) {
    const rows = await this.dataSource.query(
      `WITH wallet AS (
         SELECT balance FROM wallets WHERE id = $1
       ), entries AS (
         SELECT COALESCE(
                  (ARRAY_AGG(balance_before ORDER BY id))[1] +
                  SUM(CASE WHEN kind = 'BET' THEN -amount
                           WHEN kind IN ('WIN', 'REFUND') THEN amount
                           WHEN kind = 'ROLLBACK' AND EXISTS (
                             SELECT 1 FROM wager_transactions t
                             WHERE t.id = wallet_ledger_entries.transaction_id
                               AND t.reference_external_transaction_id IS NOT NULL
                               AND t.kind = 'ROLLBACK'
                               AND EXISTS (
                                 SELECT 1 FROM wager_transactions referenced
                                 WHERE referenced.provider_id = t.provider_id
                                   AND referenced.external_transaction_id = t.reference_external_transaction_id
                                   AND referenced.kind IN ('WIN', 'REFUND')
                               )
                           ) THEN -amount
                           WHEN kind = 'ROLLBACK' THEN amount
                           ELSE 0 END),
                  (SELECT balance FROM wallet)
                )::numeric AS calculated_balance,
                COUNT(*)::text AS checked_entries
         FROM wallet_ledger_entries WHERE wallet_id = $1
       )
       SELECT wallet.balance::text AS stored_balance,
              entries.calculated_balance::text AS calculated_balance,
              (wallet.balance - entries.calculated_balance)::text AS difference,
              entries.checked_entries
       FROM wallet CROSS JOIN entries`,
      [walletId],
    );
    const row = rows[0] as {
      stored_balance: string;
      calculated_balance: string;
      difference: string;
      checked_entries: string;
    } | undefined;
    if (!row) throw new NotFoundException('WALLET_NOT_FOUND');
    const difference = row.difference;
    return {
      walletId,
      storedBalance: row.stored_balance,
      calculatedBalance: row.calculated_balance,
      difference,
      consistent: Number(difference) === 0,
      checkedEntries: Number(row.checked_entries),
    };
  }
}
