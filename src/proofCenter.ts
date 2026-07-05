/**
 * Public Proof Center — web-verifiable audit pages for Galileo.
 *
 * Routes served by the health HTTP server:
 *   GET /proofs        — Live feed of recent verified proofs
 *   GET /verify/:root  — Recover receipt from 0G Storage root hash
 *   GET /status        — Health dashboard: compute, storage, chain, latest proof
 *   GET /intents/live  — DCA and alert executions with proof links and tx hashes
 *
 * All pages are self-contained HTML with inline CSS. No external dependencies.
 * Sensitive data (private keys, full user IDs) is redacted.
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
import { pingCompute } from './og/compute';
import { provider } from './og/chain';
import { config } from './config';
import { intentStore } from './intents/intentStore';

// ─── HTML shell ──────────────────────────────────────────────────────────

const STYLE = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;line-height:1.6;padding:2rem;max-width:960px;margin:0 auto}
h1{color:#58a6ff;font-size:1.5rem;margin-bottom:1rem}
h2{color:#f0f6fc;font-size:1.1rem;margin:1.5rem 0 .5rem}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem;margin-bottom:1rem}
.card pre{background:#0d1117;padding:.75rem;border-radius:6px;overflow-x:auto;font-size:.8rem;white-space:pre-wrap;word-break:break-all}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75rem;font-weight:600}
.badge-ok{background:#238636;color:#fff}
.badge-warn{background:#9e6a03;color:#fff}
.badge-fail{background:#da3633;color:#fff}
.badge-pending{background:#30363d;color:#8b949e}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem}
.muted{color:#8b949e;font-size:.85rem}
.mono{font-family:'JetBrains Mono','Cascadia Code',monospace;font-size:.8rem}
a{color:#58a6ff;text-decoration:none}
a:hover{text-decoration:underline}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid #30363d}
th{color:#8b949e;font-weight:500}
nav{margin-bottom:2rem}
nav a{margin-right:1.5rem;font-size:.9rem}
.redacted{color:#484f58;font-family:monospace}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #30363d;color:#484f58;font-size:.75rem}
`;

function html(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Galileo Proof Center</title><style>${STYLE}</style></head><body><nav><a href="/proofs">Proofs</a><a href="/status">Status</a><a href="/intents/live">Intents</a></nav>${body}<footer>Galileo — 0G Memory Wallet · Chain ID ${config.OG_CHAIN_ID} · All timestamps UTC</footer></body></html>`;
}

function redact(text: string, keep: number): string {
  return text.length <= keep ? text : text.slice(0, keep) + '…';
}

function redactUserId(uid: string): string {
  return uid.slice(0, 6) + '…' + uid.slice(-4);
}

// ─── Status badge helper ──────────────────────────────────────────────────

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    ok: 'badge-ok', success: 'badge-ok', active: 'badge-ok', verified: 'badge-ok',
    fired: 'badge-warn', pending: 'badge-pending', paused: 'badge-warn',
    failed: 'badge-fail', error: 'badge-fail',
  };
  return `<span class="badge ${map[status] ?? 'badge-pending'}">${status}</span>`;
}

// ─── /proofs — Live feed of recent verified proofs ────────────────────────

export async function proofsPage(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = html('Live Proofs', `
    <h1>Live Proof Feed</h1>
    <p class="muted">Recent verified wallet intents and TEE receipts from all Galileo users.</p>

    <div class="card">
      <h2>System</h2>
      <div class="grid">
        <div><span class="muted">Chain ID</span><br><strong>${config.OG_CHAIN_ID}</strong></div>
        <div><span class="muted">0G Storage</span><br><strong>${config.OG_STORAGE_ENABLED ? 'Enabled' : 'Disabled'}</strong></div>
        <div><span class="muted">Compute Fallback</span><br><strong>${config.OG_COMPUTE_FALLBACK ? 'On' : 'Off'}</strong></div>
        <div><span class="muted">Model</span><br><strong class="mono">${redact(config.OG_COMPUTE_MODEL, 30)}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>NFT Contract</h2>
      <div class="grid">
        <div><span class="muted">Address</span><br><strong class="mono">${redact(config.NFT_CONTRACT_ADDRESS, 20)}</strong></div>
      </div>
    </div>

    <p class="muted" style="margin-top:1rem">For full receipt verification, use <code>/verify/:rootHash</code> with any 0G Storage root hash.</p>
  `);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(body);
}

// ─── /verify/:root — Recover receipt from 0G Storage ──────────────────────

export async function verifyPage(_req: IncomingMessage, res: ServerResponse, input?: string): Promise<void> {
  if (!input) {
    const body = html('Verify Receipt', `
      <h1>Verify Receipt</h1>
      <p class="muted">Enter a 0G Storage root hash, user ID, or transaction hash to verify.</p>
      <div class="card">
        <form method="GET" action="/verify/">
          <input name="root" placeholder="0x… root hash, user ID, or tx hash" style="width:100%;padding:.5rem;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-family:monospace;font-size:.9rem">
          <button type="submit" style="margin-top:.5rem;padding:.5rem 1rem;background:#238636;color:#fff;border:none;border-radius:6px;cursor:pointer">Verify</button>
        </form>
      </div>
    `);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
    return;
  }

  const isUserId = /^\d{5,}$/.test(input);
  const isHex = /^0x[0-9a-fA-F]+$/.test(input);

  let recovered: any = null;
  let recoverySource = '—';
  let rootHash: string | null = null;

  if (isUserId && config.OG_STORAGE_ENABLED) {
    try {
      const { downloadJson } = await import('./og/fileStorage');
      recovered = await downloadJson<any>(input);
      recoverySource = recovered ? '0G Storage (by user ID)' : 'not-found';
    } catch (e) {
      recoverySource = `error: ${(e as Error).message.slice(0, 60)}`;
    }
  } else if (isHex && config.OG_STORAGE_ENABLED) {
    rootHash = input;
    // Try to find matching data in the local index by rootHash
    try {
      const { downloadByRootHash } = await import('./og/fileStorage');
      const result = await downloadByRootHash(input);
      if (result) {
        recovered = JSON.parse(result);
        recoverySource = '0G Storage (by root hash)';
      } else {
        recoverySource = 'not found in local index';
      }
    } catch (e) {
      recoverySource = `error: ${(e as Error).message.slice(0, 60)}`;
    }
  }

  const body = html(`Verify ${redact(input, 18)}`, `
    <h1>Receipt Verification</h1>
    <div class="card">
      <div class="grid">
        <div><span class="muted">Input</span><br><strong class="mono">${redact(input, 30)}</strong></div>
        <div><span class="muted">Type</span><br><strong>${isUserId ? 'User ID' : isHex ? 'Hex Hash' : 'Unknown'}</strong></div>
        <div><span class="muted">Recovery</span><br>${statusBadge(recovered ? 'recovered' : 'not-found')}</div>
        ${rootHash ? `<div><span class="muted">Root Hash</span><br><strong class="mono">${redact(rootHash, 20)}</strong></div>` : ''}
      </div>
    </div>
    ${recovered ? `
    <div class="card">
      <h2>Recovered Data</h2>
      <pre>${JSON.stringify(recovered, null, 2).slice(0, 4000)}</pre>
    </div>
    ` : `
    <div class="card">
      <p class="muted">No data recovered. ${config.OG_STORAGE_ENABLED ? 'The record may not exist or storage is unavailable.' : '0G Storage is disabled — receipts are only available locally.'}</p>
    </div>
    `}
    <div class="card">
      <h2>Evidence Sources</h2>
      <div class="grid">
        <div><span class="muted">0G Compute</span><br>${statusBadge(config.OG_COMPUTE_FALLBACK ? 'fallback' : 'active')}</div>
        <div><span class="muted">0G Storage</span><br>${statusBadge(config.OG_STORAGE_ENABLED ? 'active' : 'disabled')}</div>
        <div><span class="muted">0G Chain</span><br>${statusBadge('active')}</div>
        <div><span class="muted">TEE Verification</span><br>${statusBadge(config.OG_COMPUTE_FALLBACK ? 'unavailable' : 'available')}</div>
      </div>
    </div>
  `);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(body);
}

// ─── /status — Health dashboard ───────────────────────────────────────────

export async function statusPage(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Chain status
  let blockNumber = '—';
  try { blockNumber = (await provider.getBlockNumber()).toString(); } catch {}

  // Compute status
  let computeOk = false;
  let computeModel = config.OG_COMPUTE_MODEL;
  let computeVerified: boolean | null = null;
  let computeProvider: string | null = null;
  try {
    const ping = await pingCompute();
    computeOk = ping.ok;
    computeVerified = ping.verified;
    computeProvider = ping.providerAddress;
  } catch {}

  // Storage status
  const storageAvailable = config.OG_STORAGE_ENABLED;

  // Latest intent executions
  let intentCount = 0;
  let firedCount = 0;
  try {
    const all = await intentStore.listAll();
    intentCount = all.length;
    firedCount = all.filter((i: any) => i.status === 'fired').length;
  } catch {}

  const body = html('Status', `
    <h1>Health Dashboard</h1>
    <p class="muted">Real-time status of all 0G infrastructure components.</p>

    <div class="card">
      <h2>0G Chain</h2>
      <div class="grid">
        <div><span class="muted">Status</span><br>${blockNumber !== '—' ? statusBadge('ok') : statusBadge('error')}</div>
        <div><span class="muted">Block</span><br><strong>#${blockNumber}</strong></div>
        <div><span class="muted">Chain ID</span><br><strong>${config.OG_CHAIN_ID}</strong></div>
        <div><span class="muted">RPC</span><br><strong class="mono">${redact(config.OG_RPC, 30)}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>0G Compute</h2>
      <div class="grid">
        <div><span class="muted">Status</span><br>${computeOk ? statusBadge('ok') : statusBadge('pending')}</div>
        <div><span class="muted">Model</span><br><strong class="mono">${redact(computeModel, 28)}</strong></div>
        <div><span class="muted">TEE Verified</span><br>${computeVerified === true ? statusBadge('verified') : computeVerified === false ? statusBadge('fail') : statusBadge('pending')}</div>
        <div><span class="muted">Provider</span><br><strong class="mono">${computeProvider ? redact(computeProvider, 16) : '—'}</strong></div>
        <div><span class="muted">Fallback</span><br><strong>${config.OG_COMPUTE_FALLBACK ? 'On' : 'Off'}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>0G Storage</h2>
      <div class="grid">
        <div><span class="muted">Status</span><br>${storageAvailable ? statusBadge('ok') : statusBadge('pending')}</div>
        <div><span class="muted">Indexer</span><br><strong class="mono">${redact(config.OG_INDEXER_RPC, 40)}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>Intents</h2>
      <div class="grid">
        <div><span class="muted">Total</span><br><strong>${intentCount}</strong></div>
        <div><span class="muted">Fired</span><br><strong>${firedCount}</strong></div>
        <div><span class="muted">Active</span><br><strong>${intentCount - firedCount}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>Server</h2>
      <div class="grid">
        <div><span class="muted">Uptime</span><br><strong>${Math.round(process.uptime())}s</strong></div>
        <div><span class="muted">Memory</span><br><strong>${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB</strong></div>
      </div>
    </div>
  `);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(body);
}

// ─── /intents/live — DCA and alert executions ─────────────────────────────

export async function intentsLivePage(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  let rows = '';
  try {
    const all = await intentStore.listAll();
    if (all.length === 0) {
      rows = '<tr><td colspan="6" class="muted">No intents created yet.</td></tr>';
    } else {
      rows = all.map((intent: any) => {
        const typeIcon = intent.type === 'dca' ? '📊' : '🔔';
        const summary = intent.type === 'dca'
          ? `DCA ${intent.amount} ${intent.fromToken}→${intent.toToken} / ${intent.schedule.raw ?? intent.schedule.intervalMs}`
          : `Alert ${intent.symbol} ${intent.operator} $${intent.threshold}`;
        const lastExec = intent.lastExecutedAt
          ? new Date(intent.lastExecutedAt).toISOString().replace('T', ' ').slice(0, 19)
          : '—';
        const nextRun = intent.nextRunAt
          ? new Date(intent.nextRunAt).toISOString().replace('T', ' ').slice(0, 19)
          : '—';
        return `<tr>
          <td class="mono">${redactUserId(intent.userId)}</td>
          <td>${typeIcon} ${summary}</td>
          <td>${statusBadge(intent.status)}</td>
          <td class="mono">${lastExec}</td>
          <td class="mono">${nextRun}</td>
          <td>${intent.txHash ? `<a href="https://chainscan-galileo.0g.ai/tx/${intent.txHash}" target="_blank" class="mono">${redact(intent.txHash, 14)}</a>` : '—'}</td>
        </tr>`;
      }).join('\n');
    }
  } catch (e) {
    rows = `<tr><td colspan="6" class="muted">Error loading intents: ${(e as Error).message}</td></tr>`;
  }

  const body = html('Live Intents', `
    <h1>DCA &amp; Alert Executions</h1>
    <p class="muted">All scheduled intents with proof links and transaction hashes.</p>
    <div class="card" style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>User</th><th>Intent</th><th>Status</th><th>Last Executed</th><th>Next Run</th><th>Tx Hash</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(body);
}
