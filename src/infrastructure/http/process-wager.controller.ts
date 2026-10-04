import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Inject,
  InternalServerErrorException,
  HttpException,
  NotFoundException,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProcessWagerUseCase } from '../../application/use-cases/process-wager.use-case.js';
import { ProcessWagerDto } from './process-wager.dto.js';
import { canonicalPayloadHash } from './payload-hash.js';
import { logStructured } from '../observability/structured-logger.js';

@Controller(['wagers', 'wagering/transactions'])
export class ProcessWagerController {
  public constructor(@Inject(ProcessWagerUseCase) private readonly processWager: ProcessWagerUseCase) {}

  @Post()
  public async process(@Body() body: ProcessWagerDto) {
    try {
      const dto = plainToInstance(ProcessWagerDto, body);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length > 0) throw new BadRequestException(errors);
      const computedPayloadHash = canonicalPayloadHash(body);
      if (/^[a-f0-9]{64}$/i.test(dto.payloadHash) && dto.payloadHash.toLowerCase() !== computedPayloadHash) {
        throw new ConflictException('PAYLOAD_HASH_MISMATCH');
      }
      return await this.processWager.execute(dto);
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const pgUniqueViolation = typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
      if (pgUniqueViolation) throw new ConflictException('DUPLICATE_TRANSACTION');

      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      logStructured('error', 'wager_processing_failed', {
        errorCode: code,
        idempotencyKey: body.idempotencyKey,
        walletId: body.walletId,
        providerId: body.providerId ?? 'default-provider',
      });
      if (code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') throw new ConflictException(code);
      if (code === 'INVALID_REFERENCE' || code === 'REFERENCE_AMOUNT_MISMATCH') throw new ConflictException(code);
      if (code === 'WALLET_NOT_FOUND') throw new NotFoundException(code);
      if (code === 'REFERENCE_REQUIRED') throw new BadRequestException(code);
      if (code === 'PENDING_REFERENCE') throw new ConflictException(code);
      if (code === 'INSUFFICIENT_FUNDS') throw new UnprocessableEntityException(code);
      if (code.includes('currency') || code.includes('amount')) throw new UnprocessableEntityException(code);
      throw new InternalServerErrorException('FINANCIAL_PROCESSING_FAILED');
    }
  }
}
