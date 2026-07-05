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
import { looksLikeReceipt, type IntentReceipt } from './receipts';

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
    executed: 'badge-ok', pass: 'badge-ok',
    // nft_mint receipts carry status='minted' (on-chain success). Add it to
    // the green "ok" class so it doesn't fall through to the misleading
    // grey "pending" badge.
    minted: 'badge-ok',
    fired: 'badge-warn', pending: 'badge-pending', staged: 'badge-pending',
    paused: 'badge-warn', cancelled: 'badge-warn', fail: 'badge-fail',
    failed: 'badge-fail', error: 'badge-fail',
  };
  return `<span class="badge ${map[status] ?? 'badge-pending'}">${status}</span>`;
}

// ─── Receipt rendering (F5) ─────────────────────────────────────────────────

function fmtTs(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Pure function — exported so unit tests can assert on the rendered HTML
 * without spinning up the HTTP server or mocking 0G Storage. The public
 * verifyPage() routes through this same function for any recovered receipt.
 */
export function renderReceipt(r: IntentReceipt, rootHashOverride?: string | null): string {
  const typeIcon =
    r.actionType === 'send' ? '📤' :
    r.actionType === 'swap' ? '🔄' :
    r.actionType === 'dca' ? '📊' :
    r.actionType === 'alert' ? '🔔' :
    r.actionType === 'key_reveal' ? '🔐' : '🧾';
  const checksRows = r.riskChecks
    .map(
      (c) =>
        `<tr><td class="mono">${c.check}</td><td>${statusBadge(c.status)}</td><td class="mono">${fmtTs(c.ts)}</td></tr>`,
    )
    .join('\n');

  const computeBlock = r.compute
    ? `<div><span class="muted">Provider</span><br><strong class="mono">${redact(r.compute.provider, 16)}</strong></div>
       <div><span class="muted">TEE Verified</span><br>${statusBadge(r.compute.verified ? 'verified' : 'fail')}</div>
       <div><span class="muted">Chat ID</span><br><strong class="mono">${redact(r.compute.chatId, 18)}</strong></div>`
    : `<div class="muted" style="grid-column:1/-1">N/A — command-driven action (no LLM turn; keys never reached the AI agent).</div>`;

  const txLine = r.chain.txHash
    ? `<a href="https://chainscan-galileo.0g.ai/tx/${r.chain.txHash}" target="_blank" class="mono">${redact(r.chain.txHash, 20)}</a>`
    : '<span class="muted">—</span>';
  // The 0G Storage rootHash is the receipt's identity, not its content. The
  // on-Storage copy never carries its own rootHash (the rootHash IS the hash
  // of the receipt, so self-reference is meaningless), so for /verify/:root
  // the URL param is the source of truth. Fall back to r.storage.rootHash
  // for non-verify flows (e.g. unit tests with hand-built fixtures that
  // pre-populate it).
  const displayRootHash = rootHashOverride ?? r.storage.rootHash;
  const rootLine = displayRootHash
    ? `<span class="mono">${redact(displayRootHash, 20)}</span>`
    : '<span class="muted">— (not yet uploaded)</span>';

  // Action-type-specific "Parsed Intent" section.
  const parsedSection =
    r.actionType === 'send'
      ? renderSendParsed(r)
      : r.actionType === 'swap'
        ? renderSwapParsed(r)
        : r.actionType === 'dca'
          ? renderDcaParsed(r)
          : r.actionType === 'alert'
            ? renderAlertParsed(r)
            : r.actionType === 'key_reveal'
              ? renderKeyRevealParsed(r)
              : '<div class="muted">Unknown action type.</div>';
  // nft_mint is automatic — the Parsed Intent card is fully omitted; the
  // on-chain tx in "Chain" below is the canonical artifact.
  const parsedCard =
    r.actionType === 'nft_mint'
      ? ''
      : `<div class="card">
      <h2>2 · Parsed Intent</h2>
      <div class="grid">${parsedSection}</div>
    </div>`;
  // Render "automatic" instead of the grey "pending" badge for receipts that
  // are finalized without a user Confirm button — statusBadge() maps
  // `required:false` to a misleading "pending" badge. Routed through
  // confirmation.method so any future automatic receipt (nft_mint, dca
  // execution, alert fire, or a new automatic actionType) gets the right
  // label without a per-type enumeration update.
  const isAutoConfirmedReceipt =
    r.confirmation.method === 'automatic' ||
    r.confirmation.method === 'automatic_scheduled';

  // Optional intent link block (DCA execution / alert fire receipts).
  const intentLinkSection =
    'intentLink' in r && r.intentLink
      ? `<div class="card">
          <h2>Intent Link</h2>
          <div class="grid">
            <div><span class="muted">Intent ID</span><br><strong class="mono">${r.intentLink.intentId}</strong></div>
            <div><span class="muted">Creation Receipt</span><br><strong class="mono">${r.intentLink.creationReceiptId ? redact(r.intentLink.creationReceiptId, 18) : '—'}</strong></div>
          </div>
        </div>`
      : '';

  // Optional notification block (alert fire receipts only).
  const notificationSection =
    'notification' in r && r.notification
      ? `<div class="card">
          <h2>Notification</h2>
          <div class="grid">
            <div><span class="muted">Method</span><br><strong>${r.notification.method}</strong></div>
            <div><span class="muted">Sent At</span><br><strong class="mono">${fmtTs(r.notification.sentAt)}</strong></div>
            <div><span class="muted">Chat ID</span><br><strong class="mono">${redactUserId(r.notification.chatId)}</strong></div>
          </div>
        </div>`
      : '';

  return `
    <div class="card">
      <h2>${typeIcon} Verified Intent Receipt</h2>
      <div class="grid">
        <div><span class="muted">Action</span><br><strong>${r.actionType}</strong></div>
        <div><span class="muted">Status</span><br>${statusBadge(r.status)}</div>
        <div><span class="muted">Receipt ID</span><br><strong class="mono">${redact(r.receiptId, 18)}</strong></div>
        <div><span class="muted">Created</span><br><strong class="mono">${fmtTs(r.createdAt)}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>1 · User Intent</h2>
      <div class="grid">
        <div><span class="muted">Instruction</span><br><strong>${r.userIntent.raw}</strong></div>
        <div><span class="muted">Source</span><br><strong>${r.userIntent.source}</strong></div>
      </div>
    </div>

    ${parsedCard}

    <div class="card">
      <h2>3 · Risk Checks</h2>
      <table>
        <thead><tr><th>Check</th><th>Status</th><th>Timestamp</th></tr></thead>
        <tbody>${checksRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>4 · Compute (TEE)</h2>
      <div class="grid">${computeBlock}</div>
    </div>

    <div class="card">
      <h2>5 · Confirmation</h2>
      <div class="grid">
        <div><span class="muted">Required</span><br>${isAutoConfirmedReceipt ? '<strong>automatic</strong>' : statusBadge(r.confirmation.required ? 'ok' : 'pending')}</div>
        <div><span class="muted">Method</span><br><strong>${r.confirmation.method}</strong></div>
        <div><span class="muted">Confirmed At</span><br><strong class="mono">${r.confirmation.confirmedAt ? fmtTs(r.confirmation.confirmedAt) : '—'}</strong></div>
      </div>
    </div>

    ${notificationSection}

    <div class="card">
      <h2>6 · Chain</h2>
      <div class="grid">
        <div><span class="muted">Tx Hash</span><br>${txLine}</div>
      </div>
    </div>

    ${intentLinkSection}

    <div class="card">
      <h2>7 · Storage</h2>
      <div class="grid">
        <div><span class="muted">Root Hash</span><br>${rootLine}</div>
      </div>
    </div>
  `;
}

/** Send-specific parsed-intent grid (recipient + amount + wallet). */
function renderSendParsed(r: Extract<IntentReceipt, { actionType: 'send' }>): string {
  const recipient = r.parsedIntent.recipient;
  const recipientLine =
    recipient.kind === 'username'
      ? `${recipient.value} → <span class="mono">${redact(recipient.resolvedAddress, 16)}</span>`
      : `<span class="mono">${redact(recipient.resolvedAddress, 20)}</span>`;
  return `
    <div><span class="muted">Type</span><br><strong>${r.parsedIntent.type}</strong></div>
    <div><span class="muted">Amount</span><br><strong>${r.parsedIntent.amount} ${r.parsedIntent.asset}</strong></div>
    <div><span class="muted">Recipient</span><br>${recipientLine}</div>
    <div><span class="muted">From Wallet</span><br><strong>${r.parsedIntent.fromWalletName}</strong></div>
  `;
}

/** Swap-specific parsed-intent grid (kind, route, slippage, approval, path). */
function renderSwapParsed(r: Extract<IntentReceipt, { actionType: 'swap' }>): string {
  const p = r.parsedIntent;
  const kindLabel = p.kind === 'wrap' ? 'Wrap (1:1)' : p.kind === 'unwrap' ? 'Unwrap (1:1)' : 'DEX swap';
  const routeLine =
    p.kind === 'dex'
      ? `<div><span class="muted">Route</span><br><strong>${p.fromToken} → ${p.toToken}</strong></div>
         <div><span class="muted">Route Kind</span><br><strong>${p.routeKind ?? '—'}</strong></div>`
      : `<div><span class="muted">Route</span><br><strong>${p.fromToken} → ${p.toToken}</strong></div>
         <div><span class="muted">Kind</span><br><strong>${kindLabel}</strong></div>`;
  const slippageLine =
    p.kind === 'dex' && p.slippageBps !== undefined
      ? `<div><span class="muted">Slippage</span><br><strong>${(p.slippageBps / 100).toFixed(2)}%</strong></div>
         <div><span class="muted">Min Received</span><br><strong>${p.minOut ?? '—'}</strong></div>`
      : '';
  const approvalLine =
    p.kind === 'dex'
      ? `<div><span class="muted">Approval Needed</span><br>${statusBadge(p.approvalNeeded ? 'pending' : 'ok')}</div>`
      : '';
  const pathLine =
    p.kind === 'dex' && p.path && p.path.length > 0
      ? `<div style="grid-column:1/-1"><span class="muted">DEX Path</span><br><strong class="mono">${p.path
          .map((h) => redact(h, 12))
          .join(' → ')}</strong></div>`
      : '';
  return `
    <div><span class="muted">Type</span><br><strong>${p.type}</strong></div>
    <div><span class="muted">Kind</span><br><strong>${kindLabel}</strong></div>
    <div><span class="muted">Amount In</span><br><strong>${p.amountIn}</strong></div>
    <div><span class="muted">Est. Out</span><br><strong>${p.estOut}</strong></div>
    ${routeLine}
    ${slippageLine}
    ${approvalLine}
    <div><span class="muted">From Wallet</span><br><strong>${p.fromWalletName}</strong></div>
    ${pathLine}
  `;
}

/** DCA-specific parsed-intent grid (schedule, route, wallet). */
function renderDcaParsed(r: Extract<IntentReceipt, { actionType: 'dca' }>): string {
  const p = r.parsedIntent;
  return `
    <div><span class="muted">Type</span><br><strong>${p.type}</strong></div>
    <div><span class="muted">Route</span><br><strong>${p.fromToken} → ${p.toToken}</strong></div>
    <div><span class="muted">Amount</span><br><strong>${p.amount}</strong></div>
    <div><span class="muted">Schedule</span><br><strong>${p.scheduleRaw}</strong></div>
    <div><span class="muted">Interval</span><br><strong>${(p.scheduleIntervalMs / 1000 / 60).toFixed(0)} min</strong></div>
    <div><span class="muted">From Wallet</span><br><strong>${p.walletName ?? '—'}</strong></div>
  `;
}

/** Alert-specific parsed-intent grid (condition, trigger price, price source). */
function renderAlertParsed(r: Extract<IntentReceipt, { actionType: 'alert' }>): string {
  const p = r.parsedIntent;
  const opText =
    p.operator === '<' ? 'below' :
    p.operator === '>' ? 'above' :
    p.operator === '<=' ? 'at or below' : 'at or above';
  return `
    <div><span class="muted">Type</span><br><strong>${p.type}</strong></div>
    <div><span class="muted">Symbol</span><br><strong>${p.symbol}</strong></div>
    <div><span class="muted">Condition</span><br><strong>${p.symbol} ${opText} $${p.threshold}</strong></div>
    <div><span class="muted">Price Source</span><br><strong>${p.priceSource ?? '—'}</strong></div>
    ${p.triggerPrice !== undefined ? `<div><span class="muted">Trigger Price</span><br><strong>$${p.triggerPrice}</strong></div>` : ''}
    <div><span class="muted">CoinGecko ID</span><br><strong class="mono">${p.coingeckoId}</strong></div>
  `;
}

/** Key-reveal-specific parsed-intent grid (wallet, method, secret kind — redacted). */
function renderKeyRevealParsed(r: Extract<IntentReceipt, { actionType: 'key_reveal' }>): string {
  const p = r.parsedIntent;
  const methodLabel =
    p.revealMethod === 'command_privatekey' ? '/privatekey command' :
    p.revealMethod === 'button_export' ? 'Settings → Export private key' :
    p.revealMethod === 'button_new_wallet' ? 'New wallet button' :
    '/wallet command';
  const secretLabel = p.secretKind === 'recovery_phrase' ? 'Recovery phrase (BIP-39)' : 'Private key';
  return `
    <div><span class="muted">Type</span><br><strong>${p.type}</strong></div>
    <div><span class="muted">Secret Kind</span><br><strong>${secretLabel}</strong></div>
    <div><span class="muted">Wallet</span><br><strong>${p.walletName}</strong></div>
    <div><span class="muted">Wallet Address</span><br><strong class="mono">${redact(p.walletAddress, 16)}</strong></div>
    <div><span class="muted">Reveal Method</span><br><strong>${methodLabel}</strong></div>
    <div class="muted" style="grid-column:1/-1">⚠️ Local-only receipt — never uploaded to 0G Storage. No AI tool had access to the key (deterministic command/button flow).</div>
  `;
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

  // User-ID fallback: when the user navigates to /verify/<userId>, the user
  // ID key on Storage holds the F1 memory snapshot (not a receipt), so the
  // cell would otherwise show "— (not yet uploaded)". Look up the user's most
  // recent Verified Intent Receipt in the local receiptStore index and use
  // its real rootHash to download the receipt artifact from Storage. This
  // way /verify/<userId> always surfaces a real F5 receipt with a real
  // rootHash when the user has at least one.
  if (isUserId && (!recovered || !looksLikeReceipt(recovered))) {
    try {
      const store = await import('./receipts/receiptStore');
      const recent = await store.listForUser(input, 1);
      if (recent.length > 0 && recent[0].rootHash) {
        const receiptRootHash = recent[0].rootHash;
        const { downloadByRootHash } = await import('./og/fileStorage');
        const result = await downloadByRootHash(receiptRootHash);
        if (result) {
          recovered = JSON.parse(result);
          rootHash = receiptRootHash;
          const r = recent[0];
          recoverySource = `Local index → 0G Storage (user ${redact(input, 8)}'s most recent ${r.actionType} ${r.status} receipt)`;
        }
      }
    } catch {
      // non-fatal — fall through to the existing "no data recovered" message
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
    ${recovered ? (
      looksLikeReceipt(recovered)
        ? renderReceipt(recovered as IntentReceipt, rootHash)
        : `<div class="card"><h2>Recovered Data</h2><pre>${JSON.stringify(recovered, null, 2).slice(0, 4000)}</pre></div>`
    ) : `
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
