# Jungle Wallet

Implementação do teste técnico de processamento de apostas da Jungle Gaming. O projeto demonstra como processar operações financeiras com precisão decimal, segurança contra duplicidade e consistência sob concorrência.

## Objetivo

Uma operação de aposta deve alterar o saldo, registrar o histórico e publicar um evento sem deixar o sistema em estado parcial. Se a mesma requisição chegar novamente, o saldo não pode ser alterado duas vezes.

## Fluxo resumido

```text
POST /wagers
	-> validação do request
	-> lock da carteira (SELECT FOR UPDATE)
	-> débito ou crédito
	-> transação + ledger + outbox no mesmo commit
	-> worker publica a outbox no SQS
	-> Inbox evita processar o mesmo evento duas vezes
```

## Executar

O fluxo oficial usa Bun 1.x:

```bash
bun install
bun run typecheck:bun
bun test
```

Os testes unitários não dependem de Docker.

Com o PostgreSQL do Docker em execução, rode também o teste de concorrência:

```bash
bun run test:integration
```

Esse teste dispara 50 apostas simultâneas e 10 requisições duplicadas com a mesma chave de idempotência.

## PostgreSQL local

Com Docker instalado:

```bash
docker compose up -d postgres
bun run db:migrate
```

Para subir também o SQS local:

```bash
docker compose up -d postgres localstack
```

Em Linux/macOS, garanta a permissão do script de inicialização antes de subir o LocalStack:

```bash
chmod +x docker/localstack/init/ready.d/01-create-queues.sh
```

O LocalStack cria a fila `wager-events`. A aplicação usa automaticamente o endpoint local e `SQS_QUEUE_URL=http://localhost:4566/000000000000/wager-events` por padrão. Em AWS, defina `SQS_QUEUE_URL` e `AWS_REGION` com os valores do ambiente.

O schema em `src/infrastructure/database/schema.sql` é aplicado automaticamente na primeira criação do volume. Para ambientes persistentes, use as migrations versionadas com `bun run db:migrate`; o runner faz baseline automático quando encontra o schema já criado pelo Docker. A conexão padrão é `postgres://jungle:jungle@localhost:5432/jungle`.

## API

Com o banco disponível, inicie a aplicação:

```bash
bun run start
```

Copie `.env.example` para `.env` apenas se quiser sobrescrever os valores padrão. O endpoint `POST /wagers` recebe `externalTransactionId`, `idempotencyKey`, `payloadHash`, `walletId`, `roundId`, `gameId`, `kind` e `money`. Quando `API_KEY` estiver definida, envie-a no header `x-api-key`.

Exemplo:

```bash
curl -X POST http://localhost:3000/wagers \
	-H "Content-Type: application/json" \
	-H "x-api-key: change-me" \
	-d '{
		"externalTransactionId": "provider-tx-1",
		"idempotencyKey": "request-1",
		"payloadHash": "hash-1",
		"walletId": "00000000-0000-0000-0000-000000000001",
		"roundId": "round-1",
		"gameId": "game-1",
		"kind": "BET",
		"money": { "amount": "10.00", "currency": "BRL" }
	}'
```

Valores aceitos para `kind`: `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`.

Endpoints obrigatórios adicionais:

- `POST /wallets`
- `GET /wallets/:walletId`
- `GET /wallets/:walletId/ledger`
- `GET /wagering/transactions/:transactionId`
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`
- `POST /wallets/:walletId/reconciliation`

Health checks: `GET /health/live` confirma que o processo está vivo; `GET /health/ready` confirma PostgreSQL e SQS. Os aliases legados `/healthz` e `/readyz` continuam disponíveis.

## Decisões principais

- `decimal.js`: evita erros de arredondamento de `number` em valores monetários.
- `NUMERIC(18,2)`: mantém precisão exata no PostgreSQL.
- `SELECT FOR UPDATE`: serializa operações da mesma carteira e permite concorrência entre carteiras diferentes.
- Outbox transacional: o evento só é criado se a atualização financeira também for confirmada.
- Inbox idempotente: eventos repetidos não executam o handler novamente.
- `LOSS` não gera lançamento financeiro e não altera o saldo.
- `REFUND` exige referência para uma `BET`; `ROLLBACK` exige referência para
  `BET`, `WIN` ou `REFUND`. Referências ausentes ficam em `PENDING_REFERENCE`
  e são reprocessadas com backoff.

## Estrutura

- `src/domain`: regras puras de dinheiro e carteira.
- `src/application`: casos de uso e portas de saída.
- `src/infrastructure/database`: schema PostgreSQL, TypeORM `DataSource`/`QueryRunner`,
  unit of work e repositório Outbox.
- `src/infrastructure/queue`: worker de polling da Outbox.
- `tests`: comportamento do domínio e do processamento de apostas.

## Scripts

| Comando | Uso |
| --- | --- |
| `bun test` | Testes unitários e de contrato HTTP, sem Docker |
| `bun run test:integration` | Teste real de concorrência no PostgreSQL |
| `bun run typecheck:bun` | Verificação TypeScript |
| `bun run db:migrate` | Executa migrations pendentes |
| `bun run start` | Inicia a API |

O teste `tests/integration/three-processes.integration.spec.ts` inicia três
processos Node independentes contra a mesma carteira. Execute a suíte de
integração com PostgreSQL disponível para validar esse cenário.

O endpoint `/metrics` expõe contadores por status/tipo, duplicatas, retries,
falhas, latência de processamento, latência do Inbox e atraso da outbox em
formato Prometheus.

## Escopo e limitações

Este repositório é uma solução de teste técnico local. O SQS configurado no Docker é o LocalStack. Em produção, devem ser usados credenciais gerenciadas, métricas e tracing centralizados, além de políticas de segurança e rate limiting adequadas.

A implementação mantém a infraestrutura fora do domínio. `PostgresWalletUnitOfWork`
usa TypeORM `QueryRunner` com SQL parametrizado para preservar `SELECT FOR UPDATE`,
`BEGIN/COMMIT/ROLLBACK`, constraint única para `idempotency_key` e gravação de
wallet, ledger e outbox na mesma transação. Falhas técnicas são persistidas como
`FAILED` em uma transação de compensação, com `failureCode` e evento outbox.

O `PostgresOutboxRepository` reserva lotes com `FOR UPDATE SKIP LOCKED`. A publicação é at-least-once: se a publicação ocorrer e o commit falhar, a mensagem poderá ser republicada. Consumidores devem tratar o `transactionId` como chave idempotente.

O contrato de Inbox grava cada `eventId` uma única vez em `inbox_messages` antes de chamar o handler. Eventos duplicados são ignorados sem executar o handler novamente. Falhas não são confirmadas no SQS; a fila aplica retry e encaminha mensagens excedentes para a DLQ configurada no LocalStack. O teste `inbox-redelivery.spec.ts` cobre a falha entre commit do Inbox e ACK do SQS.
