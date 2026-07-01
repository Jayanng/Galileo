/**
 * 0G Compute Network broker lifecycle.
 *
 * Wraps `@0gfoundation/0g-compute-ts-sdk` to:
 *   1. Construct the broker from the operator wallet.
 *   2. Discover an inference provider that serves our model and supports TEE
 *      verification (serviceType='chatbot' AND verifiability='TeeML').
 *   3. Acknowledge the provider signer (best-effort).
 *   4. Top up the provider's inference sub-account from the main ledger if the
 *      balance is below `OG_COMPUTE_FUND_AMOUNT`.
 *
 * The selected provider address is exported via `getActiveProviderAddress()`
 * and is consumed by `src/og/compute.ts` on every chat completion to fetch
 * signed billing headers and call `processResponse`.
 *
 * If `OG_COMPUTE_FALLBACK=true` at startup, `initializeComputeBroker()` is a
 * no-op and `getActiveProviderAddress()` returns null. Callers should fall
 * back to the legacy OpenAI client in that case.
 *
 * Errors here are deliberately surfaced (not swallowed): if no TEE provider is
 * available, the bot should refuse to start unless the operator has explicitly
 * opted into fallback mode. We do not want a silent degradation to unverified
 * inference.
 */

import { createZGComputeNetworkBroker, type ZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk';
import { parseEther } from 'ethers';
import { config } from '../config';
import { operatorWallet } from './chain';

interface BrokerState {
  broker: ZGComputeNetworkBroker;
  providerAddress: string;
  model: string;
  verifiability: string;
}

let state: BrokerState | null = null;
let initError: Error | null = null;

/**
 * Pick the best inference provider from the on-chain service list.
 *
 * Selection criteria (all must match):
 *   - serviceType === 'chatbot'
 *   - verifiability === 'TeeML'   (so processResponse actually verifies)
 *   - model === OG_COMPUTE_MODEL (default behavior; skipped if
 *     OG_COMPUTE_PROVIDER_ADDRESS is set, but we still assert the override
 *     matches the filters)
 *
 * Returns the first match. If `OG_COMPUTE_PROVIDER_ADDRESS` is set, return
 * that one (assuming it passes the filters).
 */
function selectProvider(
  services: Array<{
    provider: string;
    serviceType: string;
    model: string;
    verifiability: string;
    teeSignerAcknowledged: boolean;
  }>,
  override: string,
): { provider: string; model: string; verifiability: string } | null {
  const isMatch = (s: (typeof services)[number]): boolean =>
    s.serviceType === 'chatbot' &&
    s.verifiability === 'TeeML' &&
    (override ? s.provider.toLowerCase() === override.toLowerCase() : s.model === config.OG_COMPUTE_MODEL);

  const candidates = services.filter(isMatch);

  if (override) {
    const exact = candidates.find((s) => s.provider.toLowerCase() === override.toLowerCase());
    if (!exact) return null;
    return { provider: exact.provider, model: exact.model, verifiability: exact.verifiability };
  }

  if (candidates.length === 0) return null;
  const chosen = candidates[0];
  return { provider: chosen.provider, model: chosen.model, verifiability: chosen.verifiability };
}

/**
 * Ensure the operator's main ledger account exists on-chain.
 *
 * The 0G Compute ledger uses a two-tier account model:
 *   - Main ledger: per-user, must exist before any provider sub-accounts.
 *   - Provider sub-accounts: per (user, provider, service-type).
 *
 * `getLedger` throws `Account does not exist` when the main ledger hasn't
 * been initialized yet. We call `addLedger(0)` to create the record with
 * zero balance, then `depositFund` to top it up from the wallet.
 */
async function ensureMainLedgerExists(
  broker: ZGComputeNetworkBroker,
): Promise<{ totalBalance: bigint } | null> {
  try {
    const ledger = await broker.ledger.getLedger();
    return { totalBalance: ledger.totalBalance };
  } catch (e) {
    const msg = (e as Error).message;
    if (!/account does not exist/i.test(msg) && !/AccountNotExists/.test(msg)) {
      console.warn(`[computeBroker] unexpected error reading ledger: ${msg}`);
      return null;
    }
    console.log(`[computeBroker] main ledger missing — creating with addLedger(3)`);
    try {
      // The on-chain ledger contract requires a 3 OG minimum to create a
      // ledger account. This is a one-time deposit — subsequent top-ups use
      // depositFund, and inference costs are paid from the provider sub-account.
      await broker.ledger.addLedger(3);
      console.log(`[computeBroker] main ledger created (3 OG one-time deposit)`);
      const ledger = await broker.ledger.getLedger();
      return { totalBalance: ledger.totalBalance };
    } catch (e2) {
      console.warn(`[computeBroker] addLedger failed: ${(e2 as Error).message}`);
      return null;
    }
  }
}

/**
 * Top up the provider's inference sub-account from the main ledger if the
 * current balance is below the configured threshold. No-op if balance is
 * sufficient. Logs the result either way.
 */
async function ensureSubAccountFunded(
  broker: ZGComputeNetworkBroker,
  providerAddress: string,
): Promise<void> {
  const fundAmountOG = config.OG_COMPUTE_FUND_AMOUNT;
  const thresholdWei = parseEther(fundAmountOG);

  const mainLedger = await ensureMainLedgerExists(broker);

  let subBalance = 0n;
  try {
    const providers = await broker.ledger.getProvidersWithBalance('inference');
    const entry = providers.find(([addr]) => addr.toLowerCase() === providerAddress.toLowerCase());
    if (entry) subBalance = entry[1];
  } catch (e) {
    console.warn(`[computeBroker] could not read sub-account balance: ${(e as Error).message}`);
  }

  console.log(
    `[computeBroker] main ledger=${mainLedger ? mainLedger.totalBalance.toString() : 'unknown'} wei, ` +
      `inference sub-account=${subBalance.toString()} wei`,
  );

  if (subBalance >= thresholdWei) {
    console.log(`[computeBroker] sub-account balance sufficient; no top-up needed`);
    return;
  }

  // If the main ledger is short, try to deposit the difference from the wallet.
  if (mainLedger && mainLedger.totalBalance < thresholdWei) {
    const topUpWei = thresholdWei - mainLedger.totalBalance;
    console.log(
      `[computeBroker] main ledger short by ${topUpWei.toString()} wei — calling depositFund`,
    );
    try {
      await broker.ledger.depositFund(Number(formatEtherForDeposit(topUpWei)));
      console.log(`[computeBroker] depositFund succeeded`);
      const refreshed = await broker.ledger.getLedger();
      mainLedger.totalBalance = refreshed.totalBalance;
    } catch (e) {
      console.warn(`[computeBroker] depositFund failed: ${(e as Error).message}`);
    }
  }

  if (mainLedger && mainLedger.totalBalance < thresholdWei) {
    console.warn(
      `[computeBroker] main ledger (${mainLedger.totalBalance.toString()} wei) still below top-up amount ` +
        `(${thresholdWei.toString()} wei). Skipping transferFund — bot may run out of inference credits.`,
    );
    return;
  }

  console.log(
    `[computeBroker] topping up inference sub-account for ${providerAddress} with ${fundAmountOG} OG`,
  );
  try {
    await broker.ledger.transferFund(providerAddress, 'inference', thresholdWei);
    console.log(`[computeBroker] top-up succeeded`);
  } catch (e) {
    console.warn(`[computeBroker] transferFund failed: ${(e as Error).message}`);
  }
}

/**
 * depositFund takes a `number` of whole OG tokens. For a Wei-denominated
 * delta we round up to the nearest whole OG to avoid floating-point dust.
 */
function formatEtherForDeposit(wei: bigint): string {
  // Round up to the nearest whole OG (1e18 wei).
  const ONE_OG = 1_000_000_000_000_000_000n;
  const remainder = wei % ONE_OG;
  const whole = wei / ONE_OG + (remainder > 0n ? 1n : 0n);
  return whole.toString();
}

/**
 * Initialize the 0G Compute Network broker and select a TEE-verifiable
 * provider. Safe to call only once at startup.
 *
 * If `OG_COMPUTE_FALLBACK=true`, this is a no-op and the bot should fall back
 * to the legacy router-api URL. Throws otherwise.
 */
export async function initializeComputeBroker(): Promise<void> {
  if (state) return;
  if (initError) throw initError;

  if (config.OG_COMPUTE_FALLBACK) {
    console.log(
      '[computeBroker] OG_COMPUTE_FALLBACK=true — skipping SDK broker init, using legacy router',
    );
    return;
  }

  console.log('[computeBroker] initializing 0G Compute Network broker...');

  const broker = await createZGComputeNetworkBroker(operatorWallet);

  let services: Array<{
    provider: string;
    serviceType: string;
    model: string;
    verifiability: string;
    teeSignerAcknowledged: boolean;
  }>;
  try {
    services = (await broker.inference.listService(0, 50, false)) as any[];
  } catch (e) {
    initError = new Error(`failed to list 0G Compute services: ${(e as Error).message}`);
    console.error(`[computeBroker] ${initError.message}`);
    throw initError;
  }

  console.log(`[computeBroker] found ${services.length} service(s) on-chain`);

  const override = config.OG_COMPUTE_PROVIDER_ADDRESS;
  const chosen = selectProvider(services, override);

  if (!chosen) {
    const reason = override
      ? `OG_COMPUTE_PROVIDER_ADDRESS=${override} did not match any chatbot+TeeML service`
      : `no chatbot+TeeML service found for model ${config.OG_COMPUTE_MODEL}`;
    initError = new Error(
      `${reason}. Set OG_COMPUTE_FALLBACK=true in .env to use the legacy router URL ` +
        `(verification will be unavailable), or pick a different model.`,
    );
    console.error(`[computeBroker] ${initError.message}`);
    console.error(`[computeBroker] available services (${services.length}):`);
    for (const s of services) {
      console.error(
        `  provider=${s.provider} type=${s.serviceType} model=${s.model} verifiability=${s.verifiability}`,
      );
    }
    throw initError;
  }

  console.log(
    `[computeBroker] selected provider=${chosen.provider} model=${chosen.model} verifiability=${chosen.verifiability}`,
  );

  // Acknowledge the provider signer (idempotent — already-acknowledged is fine)
  try {
    await broker.inference.acknowledgeProviderSigner(chosen.provider);
    console.log(`[computeBroker] acknowledged provider signer`);
  } catch (e) {
    console.warn(
      `[computeBroker] acknowledgeProviderSigner failed (may already be acknowledged): ${(e as Error).message}`,
    );
  }

  // Best-effort top-up. Never throws.
  await ensureSubAccountFunded(broker, chosen.provider);

  state = {
    broker,
    providerAddress: chosen.provider,
    model: chosen.model,
    verifiability: chosen.verifiability,
  };

  console.log('[computeBroker] ready');
}

/**
 * Return the initialized broker singleton. Throws if `initializeComputeBroker`
 * was not called or threw.
 */
export function getBroker(): ZGComputeNetworkBroker {
  if (!state) {
    throw new Error(
      'compute broker not initialized — call initializeComputeBroker() at startup',
    );
  }
  return state.broker;
}

/**
 * Return the currently-selected provider address. Null when running in
 * fallback mode (OG_COMPUTE_FALLBACK=true).
 */
export function getActiveProviderAddress(): string | null {
  return state?.providerAddress ?? null;
}

/**
 * True when the broker is ready (i.e. not in fallback mode and not failed).
 */
export function isReady(): boolean {
  return state !== null;
}
