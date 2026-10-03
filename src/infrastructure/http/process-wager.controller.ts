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

@Controller('wagers')
export class ProcessWagerController {
  public constructor(@Inject(ProcessWagerUseCase) private readonly processWager: ProcessWagerUseCase) {}

  @Post()
  public async process(@Body() body: ProcessWagerDto) {
    try {
      const dto = plainToInstance(ProcessWagerDto, body);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length > 0) throw new BadRequestException(errors);
      return await this.processWager.execute(dto);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      if (code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') throw new ConflictException(code);
      if (code === 'WALLET_NOT_FOUND') throw new NotFoundException(code);
      if (code === 'INSUFFICIENT_FUNDS') throw new UnprocessableEntityException(code);
      if (code.includes('currency') || code.includes('amount')) throw new UnprocessableEntityException(code);
      throw new InternalServerErrorException('FINANCIAL_PROCESSING_FAILED');
    }
  }
}
