# Arquitetura

## Limites entre camadas

- `src/domain` contém as invariantes de dinheiro e carteira e não depende de
  PostgreSQL, NestJS ou SQS.
- `src/application` contém os casos de uso e as portas. O processamento
  financeiro é executado por uma unidade de trabalho vinculada à transação.
- `src/infrastructure` adapta PostgreSQL, HTTP e SQS a essas portas.

## Consistência financeira

`ProcessWagerUseCase` bloqueia a linha da carteira com `SELECT FOR UPDATE` por
meio de um TypeORM `QueryRunner`. A
atualização da carteira, o registro da transação, o lançamento imutável do
ledger e o registro da outbox são confirmados em uma única transação do
PostgreSQL. Uma operação com falha desfaz as quatro alterações.

O dinheiro é representado como texto decimal nas fronteiras da aplicação,
`decimal.js` no domínio e `NUMERIC(18,2)` no PostgreSQL. `LOSS` não gera
lançamento financeiro e não altera o saldo. `REFUND` e `ROLLBACK` exigem uma
referência válida e não podem repetir o mesmo tipo de reversão. Falhas técnicas
são registradas como `FAILED` com `failureCode`.

## Idempotência e ordenação

`idempotency_key` é persistente e única. Uma repetição com o mesmo payload
retorna a transação original; a mesma chave com outro payload gera conflito.
As transações externas são resolvidas por
`(provider_id, external_transaction_id)`. Operações referenciadas que chegam
antes da referência são armazenadas como `PENDING_REFERENCE` e não alteram a
carteira.

## Mensageria

A outbox é gravada na transação financeira e publicada de forma assíncrona com
`FOR UPDATE SKIP LOCKED`. A entrega pelo SQS é do tipo at-least-once. Os
consumidores registram a posse dos eventos em `inbox_messages` antes de chamar
o handler e confirmam a mensagem no SQS somente após o processamento bem-sucedido.

O payload do evento usa os campos de envelope `eventId`, `eventType`,
`aggregateId`, `correlationId`, `causationId`, `occurredAt`, `version` e
`data`.

## Trade-offs e limitações

O núcleo financeiro usa TypeORM com `QueryRunner` e SQL parametrizado para
manter explícitos os limites das transações e os bloqueios de linhas. Adaptadores
legados de leitura e workers ainda usam o pool PostgreSQL enquanto são migrados
gradualmente. O desenvolvimento local usa o LocalStack; implantações em
produção devem fornecer credenciais gerenciadas, métricas, tracing, logs
estruturados, políticas de retry/DLQ e um handler de eventos de negócio completo.
