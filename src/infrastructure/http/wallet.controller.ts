import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, Matches, validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Pool } from 'pg';

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
  public constructor(@Inject(Pool) private readonly pool: Pool) {}

  @Post('wallets')
  public async createWallet(@Body() body: CreateWalletDto) {
    const dto = plainToInstance(CreateWalletDto, body);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) throw new BadRequestException(errors);
    const result = await this.pool.query(
      `INSERT INTO wallets (id, player_id, currency, balance)
       VALUES (gen_random_uuid(), $1, UPPER($2), $3)
       RETURNING id, player_id AS "playerId", currency, balance::text`,
      [dto.playerId, dto.currency, dto.initialBalance ?? '0.00'],
    );
    return result.rows[0];
  }

  @Get('wallets/:walletId')
  public async getWallet(@Param('walletId') walletId: string) {
    const result = await this.pool.query(
      `SELECT id, player_id AS "playerId", currency, balance::text, version,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM wallets WHERE id = $1`,
      [walletId],
    );
    if (!result.rows[0]) throw new NotFoundException('WALLET_NOT_FOUND');
    return result.rows[0];
  }

  @Get('wallets/:walletId/ledger')
  public async getLedger(@Param('walletId') walletId: string) {
    const result = await this.pool.query(
      `SELECT id, transaction_id AS "transactionId", amount::text, currency, kind,
              balance_before::text AS "balanceBefore", balance_after::text AS "balanceAfter",
              created_at AS "createdAt"
       FROM wallet_ledger_entries WHERE wallet_id = $1 ORDER BY id`,
      [walletId],
    );
    return { walletId, entries: result.rows };
  }

  @Get('wagering/transactions/:transactionId')
  public async getTransaction(@Param('transactionId') transactionId: string) {
    const result = await this.pool.query(
      `SELECT id, provider_id AS "providerId", external_transaction_id AS "externalTransactionId",
              idempotency_key AS "idempotencyKey", wallet_id AS "walletId", player_id AS "playerId",
              round_id AS "roundId", game_id AS "gameId", kind, money_amount::text AS "amount",
              money_currency AS currency, reference_external_transaction_id AS "referenceExternalTransactionId",
              status, balance_amount::text AS "balanceAmount", balance_currency AS "balanceCurrency",
              created_at AS "createdAt"
       FROM wager_transactions WHERE id = $1`,
      [transactionId],
    );
    if (!result.rows[0]) throw new NotFoundException('TRANSACTION_NOT_FOUND');
    return result.rows[0];
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  public async getProviderTransaction(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    const result = await this.pool.query(
      `SELECT id, provider_id AS "providerId", external_transaction_id AS "externalTransactionId",
              status, wallet_id AS "walletId", balance_amount::text AS "balanceAmount",
              balance_currency AS "balanceCurrency", created_at AS "createdAt"
       FROM wager_transactions WHERE provider_id = $1 AND external_transaction_id = $2`,
      [providerId, externalTransactionId],
    );
    if (!result.rows[0]) throw new NotFoundException('TRANSACTION_NOT_FOUND');
    return result.rows[0];
  }

  @Post('wallets/:walletId/reconciliation')
  public async reconcile(@Param('walletId') walletId: string) {
    const result = await this.pool.query<{
      stored_balance: string;
      calculated_balance: string;
      difference: string;
      checked_entries: string;
    }>(
      `WITH wallet AS (
         SELECT balance FROM wallets WHERE id = $1
       ), entries AS (
         SELECT COALESCE(
                  (ARRAY_AGG(balance_before ORDER BY id))[1] +
                  SUM(CASE WHEN kind = 'BET' THEN -amount
                           WHEN kind IN ('WIN', 'REFUND', 'ROLLBACK') THEN amount
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
    const row = result.rows[0];
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
