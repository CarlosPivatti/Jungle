import { Controller, Get, Header } from '@nestjs/common';

@Controller('demo')
export class DemoController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  public page(): string {
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Jungle Wallet - Demonstração</title>
  <style>
    :root { color-scheme: dark; font-family: Segoe UI, sans-serif; }
    body { margin: 0; background: #101827; color: #e5e7eb; }
    main { max-width: 1100px; margin: 0 auto; padding: 28px; }
    h1 { margin-bottom: 6px; color: #67e8f9; }
    .muted { color: #94a3b8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; margin: 22px 0; }
    section { background: #172235; border: 1px solid #334155; border-radius: 12px; padding: 18px; }
    button { background: #0891b2; color: white; border: 0; border-radius: 7px; padding: 10px 13px; cursor: pointer; margin: 4px 4px 4px 0; }
    button:hover { background: #06b6d4; }
    pre { background: #0b1220; border-radius: 8px; padding: 14px; min-height: 120px; overflow: auto; white-space: pre-wrap; }
    .ok { color: #86efac; } .error { color: #fca5a5; }
    code { color: #a5f3fc; }
  </style>
</head>
<body>
<main>
  <h1>Jungle Wallet</h1>
  <p class="muted">Demonstração visual dos fluxos financeiros e de infraestrutura.</p>
  <div class="grid">
    <section>
      <h2>Infraestrutura</h2>
      <button onclick="call('/health/live')">Health live</button>
      <button onclick="call('/health/ready')">Health ready</button>
      <button onclick="call('/metrics')">Métricas</button>
    </section>
    <section>
      <h2>Carteira</h2>
      <button onclick="createWallet()">Criar carteira BRL 100,00</button>
      <button onclick="showWallet()">Consultar carteira</button>
      <button onclick="showLedger()">Consultar ledger</button>
      <button onclick="reconcile()">Reconciliar</button>
    </section>
    <section>
      <h2>Operações</h2>
      <button onclick="wager('BET')">Executar BET 10,00</button>
      <button onclick="wager('LOSS')">Executar LOSS 10,00</button>
      <button onclick="duplicate()">Repetir BET (idempotência)</button>
    </section>
  </div>
  <section>
    <h2>Resultado</h2>
    <p class="muted">Wallet ID atual: <code id="wallet">nenhuma</code></p>
    <pre id="output">Aguardando uma ação...</pre>
  </section>
</main>
<script>
  let walletId = localStorage.getItem('jungle-demo-wallet') || '';
  let lastRequest;
  const output = document.getElementById('output');
  document.getElementById('wallet').textContent = walletId || 'nenhuma';
  function print(value, error = false) {
    output.className = error ? 'error' : 'ok';
    output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  async function call(path, options) {
    try {
      const response = await fetch(path, options);
      const text = await response.text();
      let body; try { body = JSON.parse(text); } catch { body = text; }
      if (!response.ok) throw new Error(response.status + ': ' + JSON.stringify(body));
      print(body);
      return body;
    } catch (error) { print(error.message, true); }
  }
  async function createWallet() {
    const body = { playerId: crypto.randomUUID(), currency: 'BRL', initialBalance: '100.00' };
    const result = await call('/wallets', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (result?.id) {
      walletId = result.id; localStorage.setItem('jungle-demo-wallet', walletId);
      document.getElementById('wallet').textContent = walletId;
    }
  }
  async function showWallet() { if (!walletId) return print('Crie uma carteira primeiro.', true); await call('/wallets/' + walletId); }
  async function showLedger() { if (!walletId) return print('Crie uma carteira primeiro.', true); await call('/wallets/' + walletId + '/ledger'); }
  async function reconcile() { if (!walletId) return print('Crie uma carteira primeiro.', true); await call('/wallets/' + walletId + '/reconciliation', {method:'POST'}); }
  async function wager(kind) {
    if (!walletId) return print('Crie uma carteira primeiro.', true);
    lastRequest = { providerId:'demo-provider', externalTransactionId:crypto.randomUUID(), idempotencyKey:crypto.randomUUID(), payloadHash:'demo-payload', walletId, roundId:'demo-round', gameId:'demo-game', kind, money:{amount:'10.00', currency:'BRL'} };
    await call('/wagering/transactions', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(lastRequest)});
  }
  async function duplicate() {
    if (!lastRequest) return print('Execute uma BET primeiro.', true);
    await call('/wagering/transactions', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(lastRequest)});
  }
</script>
</body>
</html>`;
  }
}
