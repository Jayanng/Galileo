import { isAddress, parseEther } from 'ethers';
import { getActiveId } from '../wallet/activeWallet';
import { listWallets, getSigner, getWalletBalance } from '../wallet/walletService';
import { formatOG } from '../og/chain';
import { recordTx } from '../ai/memory';
import { pendingSends } from './pendingSend';
import { stageSendReceipt, finalizeReceipt, failReceipt } from '../receipts';

export type PrepareSendResult = { ok: true; summary: string } | { ok: false; error: string };
export type ExecuteSendResult =
  | { ok: true; hash: string; summary: string; receiptId?: string; receiptRootHash?: string | null }
  | { ok: false; error: string };

export interface PrepareSendReq {
  to: string;
  amount: string;
  recipientKind?: 'address' | 'username';
  resolvedUsername?: string;
  rawInput?: string;
  source?: 'command' | 'nl' | 'button';
}

export async function prepareSend(
  userId: string,
  req: PrepareSendReq,
): Promise<PrepareSendResult> {
  if (!isAddress(req.to)) {
    return { ok: false, error: `"${req.to}" is not a valid address.` };
  }

  let amountWei: bigint;
  try {
    amountWei = parseEther(req.amount);
  } catch {
    return { ok: false, error: `"${req.amount}" is not a valid amount.` };
  }
  if (amountWei <= 0n) return { ok: false, error: 'Amount must be greater than zero.' };

  const wallets = await listWallets(userId);
  if (wallets.length === 0) {
    return { ok: false, error: 'You have no wallets. Send /wallet to create one.' };
  }
  const activeId = await getActiveId(userId);
  const wallet = wallets.find((w) => w.id === activeId) ?? wallets[0]!;

  const balance = await getWalletBalance(userId, wallet.id);
  if (balance === null) return { ok: false, error: 'Could not read wallet balance.' };
  if (balance < amountWei) {
    return {
      ok: false,
      error: `Insufficient balance. You have ${formatOG(balance)} OG but need ${req.amount} OG (plus gas).`,
    };
  }

  const amountLabel = `${req.amount} OG`;
  const toLine =
    req.recipientKind === 'username' && req.resolvedUsername
      ? `\`@${req.resolvedUsername}\` → \`${req.to}\``
      : `\`${req.to}\``;
  const summary = [
    `📤 *Send ${amountLabel}*`,
    '',
    `From: *${wallet.name}*`,
    `\`${wallet.address}\``,
    '',
    'To:',
    toLine,
  ].join('\n');

  const receiptId = stageSendReceipt({
    userId,
    amount: req.amount,
    recipientKind: req.recipientKind === 'username' ? 'username' : 'address',
    resolvedUsername: req.resolvedUsername,
    resolvedAddress: req.to,
    walletId: wallet.id,
    walletName: wallet.name,
    rawInput: req.rawInput,
    source: req.source ?? 'command',
  });

  pendingSends.set(userId, {
    walletId: wallet.id,
    walletName: wallet.name,
    toAddress: req.to,
    amountWei: amountWei.toString(),
    amountLabel,
    summary,
    recipientKind: req.recipientKind,
    resolvedUsername: req.resolvedUsername,
    receiptId,
  });

  return { ok: true, summary };
}

export async function executeSend(userId: string): Promise<ExecuteSendResult> {
  const p = pendingSends.get(userId);
  if (!p) return { ok: false, error: 'No pending send — start a new one.' };
  pendingSends.clear(userId);

  const signer = await getSigner(userId, p.walletId);
  if (!signer) {
    if (p.receiptId) failReceipt(p.receiptId, 'Could not load wallet.').catch(() => {});
    return { ok: false, error: 'Could not load wallet.' };
  }

  try {
    const tx = await signer.sendTransaction({ to: p.toAddress, value: BigInt(p.amountWei) });
    const txReceipt = await tx.wait();
    recordTx(userId, { type: 'send', amount: p.amountLabel, to: p.toAddress, hash: tx.hash }).catch(() => {});

    // F5: finalize the Verified Intent Receipt (sets txHash + user_confirmed,
    // uploads to 0G Storage under receipt:<id>, indexes the rootHash). The
    // block number lets /verify render the canonical on-chain block timestamp.
    let receiptRootHash: string | null = null;
    if (p.receiptId) {
      try {
        const finalized = await finalizeReceipt(p.receiptId, tx.hash, txReceipt?.blockNumber);
        receiptRootHash = finalized?.rootHash ?? null;
      } catch (e) {
        console.warn(`[send] receipt finalize failed for ${p.receiptId}:`, (e as Error).message);
      }
    }

    return {
      ok: true,
      hash: tx.hash,
      summary: p.summary,
      receiptId: p.receiptId,
      receiptRootHash,
    };
  } catch (e) {
    if (p.receiptId) failReceipt(p.receiptId, (e as Error).message).catch(() => {});
    return { ok: false, error: (e as Error).message };
  }
}
