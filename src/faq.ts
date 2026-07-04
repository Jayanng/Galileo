/**
 * FAQ shown by the ❓ Help button on the home dashboard (handleFaq in
 * src/handlers/walletHandlers.ts). Also reachable implicitly via /help's
 * "this message" pointer.
 *
 * Structure contract — keep section headers stable so future features can slot
 * into a clear home and long-time users keep their mental map:
 *
 *   1. Dashboard buttons       (what you can tap)
 *   2. Commands                (deterministic shortcuts)  ← sourced via SSOT
 *   3. Or just chat            (natural-language examples)
 *   4. Scheduled automations   (DCA + alerts)
 *   5. Memory & verification   (0G Storage + 0G Compute TEE)
 *   6. Stay safe               (security rules)
 *
 * Section §2 derives from src/helpContent.ts → COMMANDS so /help and FAQ §2
 * can never drift. Everything else is plain prose — feel free to rewrite, but
 * keep the section headers and numbering stable. Aim for < 3500 chars to
 * stay well under Telegram's single-message limit.
 */

import { renderFaqLines } from './helpContent';

export const FAQ_TEXT = [
  '❓ *Galileo — Quick-reference guide*',
  '',
  'Tap any dashboard button to act, type `/help` for the command list, or just chat in plain language. The bot understands English, Pidgin, Yoruba, French, Spanish, and more.',
  '',
  '─ 1. Dashboard buttons ─',
  'From `/start` you can tap:',
  '• 📥 *Deposit* — show your address + QR to receive OG',
  '• 📤 *Send* — to a `@handle` or `0x…` address (always shows Confirm)',
  '• 🔄 *Swap* — wrap/unwrap OG↔WOG or swap via the DEX (USDC/USDT)',
  '• ⚙️ *Settings* — export private key, rename wallet',
  '• ➕ *New wallet* — generates a fresh wallet (key + seed phrase shown once)',
  '• ⬇️ *Import wallet* — bring an existing 0G wallet via its private key',
  '• ❓ *Help* — this guide',
  '',
  '─ 2. Commands (deterministic shortcuts) ─',
  ...renderFaqLines(),
  '',
  '─ 3. Or just chat (the AI agent does the rest) ─',
  'Try talking naturally — examples:',
  '• "create me a wallet"',
  '• "what\'s my balance?"',
  '• "send 0.1 OG to @tebasv2"',
  '• "swap 0.1 OG to USDC"',
  '• "show my P&L this week"',
  '• "what did I do yesterday?"',
  '• "how many transactions have I done?"',
  '',
  '─ 4. Scheduled automations (talk them into existence) ─',
  '• *DCA* — recurring swap on a schedule, e.g. "dca 1 OG into USDC weekly". Supported paths: *OG↔USDC*, *OG↔USDT*, *OG↔WOG* (wrap), *WOG↔OG* (unwrap).',
  '• *Alerts* — one-shot Telegram ping when a price crosses your threshold, e.g. "alert me if OG drops below $1".',
  '• Manage: `/intents` lists them all, or use Cancel / Pause buttons on each row.',
  '',
  '─ 5. Memory + verification ─',
  'Every interaction is permanently stored on 0G Storage, so the bot can answer questions like "what did I do last week?" months later.',
  'Every AI reply is signed by a TEE enclave on 0G Compute. `/proof` shows your last 10 verified chat IDs.',
  '',
  '─ 6. Stay safe ─',
  '• 🔐 *Never* share or paste your private key in DMs to anyone but this bot. *The bot will never DM you to ask for it.*',
  '• When the bot asks for a private key (only the explicit `/import` flow), delete the message after sending — the bot does this best-effort too.',
  '• Every on-chain move (send / swap / wrap) shows a Confirm button. Tapping Confirm is the only way funds move.',
  '• Imported wallets have *no seed phrase* — back up via `/privatekey` if you want a paper recovery word list later.',
  '• The bot sees everything you write; remember it\'s stored on 0G Storage forever.',
].join('\n');
