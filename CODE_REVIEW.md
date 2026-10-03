# Review do Jungle Wallet

Oi, Carlos.

Li o projeto com calma. Este arquivo é só um review de aprendizado.
Você **não precisa aceitar este PR**. Ele existe para a gente conversar no GitHub.

Pense assim: um review não é “certo ou errado”. É alguém olhando o código e perguntando:
“isso faz o que a gente espera quando o dinheiro entra no jogo?”

---

## O que o projeto faz

Uma aposta chega em `POST /wagers`.
O sistema trava a carteira, muda o saldo, grava o histórico e deixa um recado (outbox) para publicar depois.
Se a mesma requisição voltar, o saldo não pode mudar de novo.

Essa ideia está clara. E está bem organizada:

- `src/domain`: regras de dinheiro e carteira
- `src/application`: o que o sistema faz (casos de uso)
- `src/infrastructure`: banco, HTTP e fila

Isso ajuda a ler. Quem chega depois encontra as coisas no lugar certo.

---

## O que já está bem

**Dinheiro sem `number`.** Em `Money`, você usa `decimal.js` e no banco `NUMERIC(18,2)`.
Em JavaScript, `0.1 + 0.2` não dá `0.3`. Em saldo de jogo, isso vira prejuízo.

**Uma transação só.** Carteira, ledger e outbox entram no mesmo `BEGIN/COMMIT`.
Se uma parte falhar, o banco desfaz tudo. Ninguém fica com saldo mudado e evento perdido.

**Trava da carteira.** `SELECT FOR UPDATE` faz as apostas da mesma carteira esperarem a vez.
O teste de integração com 50 apostas ao mesmo tempo mostra que você pensou nisso de verdade.

**Idempotência.** Tem chave única, tem replay, e tem um segundo lookup depois do lock.
Isso fecha a janela de duas requisições iguais chegando juntas.

**Testes no comportamento.** Você testou débito, replay e concorrência. Isso vale mais do que testar detalhe interno.

Se quiser ver essa organização de camadas em vídeo:

- [Intensivão de Clean Architecture e TypeScript](https://www.youtube.com/watch?v=yLPxkIxbNDg)
- [TDD e Clean Architecture na prática com Node.js](https://www.youtube.com/watch?v=t9ozcycl7YQ)

Para transação de banco (tudo ou nada):

- [Akitando: discutindo sobre banco de dados](https://www.youtube.com/watch?v=Bfm3Ms2cTg0&t=1905s) (começa na parte de proteção e consistência)

---

## Pontos para pensar

### 1. O hash da requisição não pode vir pronto do cliente

Arquivo: `src/application/use-cases/process-wager.use-case.ts`

Hoje o cliente manda `payloadHash`.
Se a mesma `idempotencyKey` voltar, o código só compara esse hash.

O problema: quem manda o pedido também manda o hash.
Se alguém repetir a chave com **outro valor** e o **mesmo hash**, o sistema devolve o primeiro resultado e não percebe a diferença.

Em dinheiro, a regra boa é: **o servidor calcula o hash** do que recebeu (carteira, tipo, valor, moeda).
Aí o cliente não escolhe a “prova” da requisição.

Isso é o ponto mais importante deste review.

Para estudar isso com calma:

- [Idempotência: como a API evita requisição duplicada](https://www.youtube.com/watch?v=kPVyD517YiY) (curto)
- [Idempotência em APIs e mensageria](https://www.youtube.com/watch?v=fcRik4_Zuw8)
- [Design de APIs resilientes: técnicas de idempotência](https://www.youtube.com/watch?v=bnRZTi3C_JM)

A ideia é sempre a mesma: a mesma requisição pode chegar duas vezes. O servidor é quem decide o que já foi processado.

---

### 2. Sem `API_KEY`, a API fica aberta

Arquivo: `src/infrastructure/http/api-key.guard.ts`

Se `API_KEY` não estiver no ambiente, o guard deixa todo mundo passar.
No `.env.example` essa chave está comentada. Para estudar no seu computador, tudo bem.

Só lembrar: quem chama `POST /wagers` escolhe o `walletId`.
Qualquer pessoa que alcançar a API consegue mexer em qualquer carteira.

Para um teste técnico local, não é o fim do mundo.
Se um dia isso for para um servidor na internet, a chave precisa estar ligada.

Para ver como o NestJS organiza API, DTO e validação:

- [Construindo aplicações com Nest.js e Clean Architecture](https://www.youtube.com/watch?v=CpBqpsINims)
- [Intensivão Nest.js 10](https://www.youtube.com/watch?v=74Rks96yaAY) (tem ValidationPipe na prática)

---

### 3. Publicar no SQS com a transação do banco ainda aberta

Arquivo: `src/application/use-cases/publish-outbox.use-case.ts`

O fluxo atual é:

1. trava as mensagens no banco
2. manda para o SQS
3. marca como publicado
4. só então faz `COMMIT`

Enquanto o SQS responde, o banco fica esperando com a linha travada.
Se a rede estiver lenta, outras publicações esperam.

O padrão mais simples de outbox é:

1. grava a mensagem
2. commita no banco
3. publica na fila
4. marca como publicado numa transação curta

O README já avisa que a publicação é “pelo menos uma vez”.
Isso está certo. Consumidor precisa aceitar mensagem repetida. Você já pensou nisso.

Vídeo direto no que você implementou:

- [Padrões de resiliência: Transactional Outbox](https://www.youtube.com/watch?v=Fl_zXWvK2F8)

Ele mostra o ponto-chave: primeiro grava no banco, depois publica. Se a fila cair, a mensagem continua na tabela.

---

### 4. Erro escondido no worker e no consumer

Arquivos:

- `src/infrastructure/queue/outbox.worker.ts`
- `src/infrastructure/queue/sqs-inbox.consumer.ts`

Os dois fazem `.catch(() => undefined)`.
Se o SQS cair ou o JSON vier quebrado, o processo continua como se nada tivesse acontecido.

Para quem está aprendendo, a regra é: **erro precisa aparecer**.
Um `console.error` já ajuda. Depois entra log estruturado.

No consumer, `JSON.parse` sem `try/catch` também pode derrubar o ciclo inteiro se o corpo da mensagem for inválido.

Para entender por que esconder erro é perigoso:

- [Error handling no JavaScript: let it crash e graceful shutdown](https://www.youtube.com/watch?v=iC_tKAyLeag)

---

### 5. A validação HTTP está duas vezes

Arquivo: `src/infrastructure/http/process-wager.controller.ts`

O `main.ts` já liga o `ValidationPipe`.
O controller chama `plainToInstance` e `validate` de novo.

Uma das duas basta.
Menos código, mesmo resultado, mais fácil de ler.

- [Intensivão Nest.js: do básico ao avançado](https://www.youtube.com/watch?v=PHIMN85trgk) (DTO e `class-validator`)

---

### 6. Dúvida de regra: crédito sem olhar a aposta original

Arquivo: `src/application/use-cases/process-wager.use-case.ts`

`WIN`, `REFUND` e `ROLLBACK` só creditam o valor.
Não vi uma checagem do tipo: “existe um `BET` dessa rodada para devolver?”

Pergunta sincera: o provedor do jogo já garante isso, e o seu serviço só aplica o valor?
Ou a carteira deveria recusar um `REFUND` solto?

Não estou dizendo que está errado. Só que a regra precisa ficar explícita.
Dinheiro sem regra escrita vira discussão depois.

---

### 7. Detalhe: zero pode passar como valor válido

Arquivo: `src/domain/value-objects/money.vo.ts`

`isPositive()` do `decimal.js` trata `0` como positivo.
Então `BET` de `0.00` pode passar e ainda subir a `version` da carteira.

Se a regra de negócio for “valor tem que ser maior que zero”, o teste certo é: maior que zero, não só “não é negativo”.

---

## Como ler isso sem se perder

Ordem boa para estudar o próprio código:

1. `Money` e `Wallet` (a regra pura)
2. `ProcessWagerUseCase` (o filme da aposta)
3. `PostgresWalletUnitOfWork` (como o banco segura isso)
4. Outbox e Inbox (o recado que sai e o recado que entra)

Quando algo parecer difícil, pergunte:
“se essa linha falhar agora, o saldo fica certo?”

Se a resposta for sim, você está no caminho.

---

## Conclusão

O desenho está sólido para um teste técnico: domínio separado, transação única, lock, outbox e testes de concorrência.

O ajuste que mais muda o risco é o **hash calculado no servidor**.
O resto é melhoria de clareza, operação e regra de negócio.

Pode responder neste PR com dúvida. Review é conversa, não nota.

---

## Playlist rápida (tudo em português)

Assista nesta ordem, se tiver pouco tempo:

1. [Idempotência em 1 minuto](https://www.youtube.com/watch?v=kPVyD517YiY)
2. [Transactional Outbox](https://www.youtube.com/watch?v=Fl_zXWvK2F8)
3. [Clean Architecture com TypeScript](https://www.youtube.com/watch?v=yLPxkIxbNDg)
4. [Nest.js e Clean Architecture](https://www.youtube.com/watch?v=CpBqpsINims)
5. [Transação e consistência no banco](https://www.youtube.com/watch?v=Bfm3Ms2cTg0&t=1905s)
6. [Error handling no JavaScript](https://www.youtube.com/watch?v=iC_tKAyLeag)
7. [SOLID e design de software na prática](https://www.youtube.com/watch?v=4oVByCJJkRI)

Boa prática simples, sem vídeo:

- Quem manda o pedido **não** escolhe a prova do pedido. O servidor calcula o hash.
- Erro some? Então o bug também some da vista. Loga.
- Validação num lugar só.
- Dinheiro: `decimal` ou centavos. Nunca `number` solto.
