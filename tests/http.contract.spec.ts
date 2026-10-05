import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProcessWagerController } from '../src/infrastructure/http/process-wager.controller.js';
import { ProcessWagerUseCase } from '../src/application/use-cases/process-wager.use-case.js';
import { canonicalPayloadHash } from '../src/infrastructure/http/payload-hash.js';

const validBody = {
  externalTransactionId: 'external-1',
  idempotencyKey: 'idem-1',
  payloadHash: '',
  walletId: 'wallet-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: 'BET',
  money: { amount: '10.00', currency: 'BRL' },
};
validBody.payloadHash = canonicalPayloadHash(validBody);

describe('wager HTTP contract', () => {
  let application: INestApplication;
  const execute = async () => ({
    transactionId: 'transaction-1',
    status: 'PROCESSED' as const,
    balance: { amount: '90.00', currency: 'BRL' },
    idempotentReplay: false,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProcessWagerController],
      providers: [
        { provide: ProcessWagerUseCase, useValue: { execute } },
        { provide: ProcessWagerController, inject: [ProcessWagerUseCase], useFactory: (useCase: ProcessWagerUseCase) => new ProcessWagerController(useCase) },
      ],
    }).compile();
    application = module.createNestApplication();
    application.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await application.init();
  });

  afterAll(async () => { await application.close(); });

  it('accepts a valid wager', async () => {
    const response = await request(application.getHttpServer()).post('/wagers').send(validBody);
    expect(response.status).toBe(201);
    expect(response.body.transactionId).toBe('transaction-1');
  });

  it('rejects malformed money', async () => {
    const response = await request(application.getHttpServer()).post('/wagers').send({
      ...validBody,
      money: { amount: '10.001', currency: 'BRL' },
    });

    expect(response.status).toBe(400);
  });

  it('rejects a payload hash that does not match the body', async () => {
    const response = await request(application.getHttpServer()).post('/wagers').send({
      ...validBody,
      payloadHash: '0'.repeat(64),
    });
    expect(response.status).toBe(409);
  });

  it('maps unique constraint violations to conflict', async () => {
    const duplicateUseCase = { execute: async () => {
      const error = new Error('duplicate') as Error & { code?: string };
      error.code = '23505';
      throw error;
    } };

    const duplicateModule = await Test.createTestingModule({
      controllers: [ProcessWagerController],
      providers: [
        { provide: ProcessWagerUseCase, useValue: duplicateUseCase },
        { provide: ProcessWagerController, inject: [ProcessWagerUseCase], useFactory: (useCase: ProcessWagerUseCase) => new ProcessWagerController(useCase) },
      ],
    }).compile();

    const duplicateApp = duplicateModule.createNestApplication();
    duplicateApp.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await duplicateApp.init();

    const response = await request(duplicateApp.getHttpServer()).post('/wagers').send(validBody);
    expect(response.status).toBe(409);

    await duplicateApp.close();
  });
});
