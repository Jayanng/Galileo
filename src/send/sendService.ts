import { isAddress, parseEther } from 'ethers';
import { getActiveId } from '../wallet/activeWallet';
import { listWallets, getSigner, getWalletBalance } from '../wallet/walletService';
import { formatOG } from '../og/chain';
import { recordTx } from '../ai/memory';
import { pendingSends } from './pendingSend';

export type PrepareSendResult = { ok: true; summary: string } | { ok: false; error: string };
export type ExecuteSendResult = { ok: true; hash: string; summary: string } | { ok: false; error: string };

export interface PrepareSendReq {
  to: string;
  amount: string;
  recipientKind?: 'address' | 'username';
  resolvedUsername?: string;
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

  pendingSends.set(userId, {
    walletId: wallet.id,
    walletName: wallet.name,
    toAddress: req.to,
    amountWei: amountWei.toString(),
    amountLabel,
    summary,
    recipientKind: req.recipientKind,
    resolvedUsername: req.resolvedUsername,
  });

  return { ok: true, summary };
}

export async function executeSend(userId: string): Promise<ExecuteSendResult> {
  const p = pendingSends.get(userId);
  if (!p) return { ok: false, error: 'No pending send — start a new one.' };
  pendingSends.clear(userId);

  const signer = await getSigner(userId, p.walletId);
  if (!signer) return { ok: false, error: 'Could not load wallet.' };

  try {
    const tx = await signer.sendTransaction({ to: p.toAddress, value: BigInt(p.amountWei) });
    await tx.wait();
    recordTx(userId, { type: 'send', amount: p.amountLabel, to: p.toAddress, hash: tx.hash }).catch(() => {});
    return { ok: true, hash: tx.hash, summary: p.summary };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
