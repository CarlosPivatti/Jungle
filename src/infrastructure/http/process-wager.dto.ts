import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import type { WagerKind } from '../../application/use-cases/process-wager.use-case.js';

export class MoneyDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  public amount!: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  public currency!: string;
}

export class ProcessWagerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  public providerId?: string;

  @IsString()
  @IsNotEmpty()
  public externalTransactionId!: string;

  @IsString()
  @IsNotEmpty()
  public idempotencyKey!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-f0-9]{64}$/i)
  public payloadHash!: string;

  @IsString()
  @IsNotEmpty()
  public walletId!: string;

  @IsString()
  @IsNotEmpty()
  public roundId!: string;

  @IsString()
  @IsNotEmpty()
  public gameId!: string;

  @IsIn(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'] satisfies WagerKind[])
  public kind!: WagerKind;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  public referenceExternalTransactionId?: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  public money!: MoneyDto;
}
