# Usage Reference

> **← Back to [README.md](../README.md)** for the project overview, hero pitch, and the
> Verifiable Intent Pipeline.

This document is the **detailed usage reference** for Galileo — every command, every
natural-language pattern, and every quick-action button. The README keeps a high-level
overview; this is where you come when you need the full reference.

Galileo is the verifiable AI wallet on 0G. **No value moves without a Verified Intent
Receipt** — every send, swap, DCA, alert, and key-reveal emits one to 0G Storage, and every
one ends with a public verification link at [`/verify/:root`](https://galileo-test.fly.dev/verify/).
The patterns below all ride on that primitive.

The in-bot **❓ Help** button on `/start` shows a brutally-short version of this same
information, generated from the same single source (`src/helpContent.ts`), so the two
can never drift.

---

## Dashboard Buttons (`/start`)

From the home dashboard, you can tap:

| Button | What it does |
|---|---|
| 📥 Deposit | Show your active wallet's address + QR to receive OG |
| 📤 Send | Pick `@handle` or `0x…` and an amount; always shows a Confirm button before moving funds |
| 🔄 Swap | Wrap/unwrap (OG↔WOG) or swap via the DEX (OG↔USDC/USDT) |
| ⚙️ Settings | Export private key (one-tap hide) or rename the wallet |
| ➕ New wallet | Generates a fresh wallet; shows the new key + seed phrase once |
| ⬇️ Import wallet | Bring an existing 0G wallet into Galileo by private key |
| ❓ Help | Show this guide (compact in-bot version) |

---

## Commands (deterministic shortcuts)

For latency-sensitive or guaranteed-execution flows, the bot also accepts explicit
commands. These bypass the LLM tool-calling layer and always show a Confirm button
before anything moves on-chain:

| Command | What it does |
|---|---|
| `/start` | Open your dashboard |
| `/wallet` | Create a new wallet |
| `/import` (or `/import <key>`) | Import an existing wallet by private key. With no args, runs a guided flow that prompts for the key on the next message |
| `/address` | Pick a wallet and show its QR |
| `/balance` | OG balance for every wallet |
| `/privatekey` | Reveal a wallet's private key (one-tap hide) |
| `/send <recipient> <amount>` | Send OG (e.g. `/send @tebasv2 0.1` or `/send 0x… 0.1`) |
| `/wrap <amount>` | Wrap OG → WOG (e.g. `/wrap 0.1`) |
| `/unwrap <amount>` | Unwrap WOG → OG (e.g. `/unwrap 0.1`) |
| `/swap <amount> <FROM> <TO>` | Token swap (e.g. `/swap 0.1 OG USDC`); opens the Swap menu with no args |
| `/portfolio` | All wallets with USD prices + grand total (records a daily snapshot) |
| `/price <symbol\|coingecko-id>` | USD price lookup (e.g. `/price OG`, `/price bitcoin`) |
| `/history [week\|month]` | Portfolio P&L over time from daily snapshots |
| `/intents` | List DCA + alert intents with Cancel/Pause buttons |
| `/cancel <id>` | Cancel a scheduled intent by id |
| `/pause <id>` | Pause or resume a scheduled intent by id |
| `/proof` | List your last 10 TEE-verified chats |
| `/receipt` | List your most recent Verified Intent Receipts (send/swap/DCA/alert/key-reveal) with root hashes |
| `/skip` | Skip the wallet naming prompt (keep current/default name) |
| `/help` | Show the compact in-bot command list |

> Deterministic parsing lives in `src/handlers/swapUiHandlers.ts`,
> `src/handlers/sendUiHandlers.ts`, and `src/handlers/intentUiHandlers.ts`;
> fuzzy natural-language phrases fall through to the AI agent.

---

## Natural Language Examples

The AI agent understands your intent from plain English. A non-exhaustive sample:

| You say | Bot does |
|---|---|
| *"create me a wallet"* | Generates a new wallet, shows key + address, prompts for name |
| *"create a wallet called savings"* | Creates a wallet named "savings" |
| *"what's my balance?"* | Shows OG balance for all wallets |
| *"show my wallets"* | Lists all wallets with addresses and names |
| *"show my address"* | Shows wallet picker, then address + QR |
| *"rename my wallet to main"* | Renames the specified wallet |
| *"what did I do yesterday?"* | Searches permanent memory for yesterday's activity |
| *"what's my first wallet?"* | Recalls the earliest wallet creation from memory |
| *"send 0.1 OG to @tebasv2"* | Resolves `@tebasv2` to their active wallet and shows a Confirm button |
| *"/send 0xAbC… 0.1"* | Stages a send to that exact address |
| *"swap 0.1 OG to USDC"* | Stages a token swap and shows a Confirm button |
| *"wrap 1 OG"* | Stages a wrap (OG → WOG) and shows a Confirm button |
| *"what's my portfolio worth?"* | Shows all wallets with USD prices + grand total |
| *"how much is bitcoin?"* | Quick CoinGecko USD price lookup |
| *"how many transactions have I done?"* | Total tx count, breakdown by type, total volume per token (via `transaction_stats`) |
| *"show my P&L this week"* | Daily snapshot table with % change vs baseline |
| *"delete my savings wallet"* | Permanently deletes a wallet (requires confirmation) — no `/delete` command, chat only |
| *"what is this contract? 0x…"* | Explains any contract address: name, token symbol, purpose (via `explain_contract`) |
| *"what did this transaction do? 0x…"* | Decodes tx calldata: from, to, value, function called, success (via `explain_transaction`) |
| *"how many Galileo users are there?"* | Community leaderboard / total unique users (via `get_leaderboard`) |
| *"sort my wallets by oldest first"* | Timeline of wallet creation dates (via `get_wallet_timeline`) |
| *"what's my total OG across all wallets?"* | Sums OG balances across all wallets (via `get_total_og`) |
| *"import this wallet: 0x…"* | Handled by `/import`, not the LLM — keys are never exposed to the agent |

---

## Scheduled Automations

Talk them into existence:

- **DCA** — *"dca 1 OG into USDC weekly"*. Recurring swap on schedule.
  Supported paths: `OG↔USDC`, `OG↔USDT`, `OG↔WOG` (wrap), `WOG↔OG` (unwrap).
  Bot's worker ticks every 30 s and fires the swap on schedule.
- **Price alerts** — *"alert me if OG drops below $1"*. One-shot Telegram ping when
  the price crosses your threshold.
- **Manage** — `/intents` lists them all with inline Cancel / Pause buttons, or use
  `/cancel <id>` / `/pause <id>`.

---

## Imports (Private Key)

To bring an existing wallet into Galileo, use `/import`.

- **No-arg form** — `/import` replies with a prompt; send the *private key* as your
  next message (64 hex chars, with or without `0x` prefix). The bot derives the
  address, shows a preview with **Confirm** / **Cancel**, and only writes to disk
  after Confirm.
- **Inline form** — `/import <key>` shows the preview immediately.
- **5-minute preview TTL** — the Confirm/Cancel preview expires after 5 minutes.
  If the user waits too long, tapping Confirm will silently fail; re-run `/import`
  to start fresh.
- **Duplicate detection** — the bot refuses to import an address that already exists
  in your wallet set, naming the conflicting wallet (no silent overwrites).
- **Encryption** — on Confirm, the key is encrypted with **AES-256-GCM** and written
  to the wallet store, same as wallets created in-app.
- **Auto-naming** — imported wallets are named `"Imported 1"`, `"Imported 2"`, etc.
  Rename anytime via chat or `/rename`.
- **Privacy** — best-effort deletion of the message containing your key (private chats
  only); the bot will also tell you to delete it manually.
- **No seed phrase** — imported wallets are inspected against `wallet.createRandom()`,
  so `encMnemonic` is intentionally absent. Back up via `/privatekey` for a paper
  recovery word list.
- **No LLM exposure** — `/import` is a command + button flow only; private keys are
  never sent to the AI agent.

---

## Multi-Language Support

Galileo auto-detects and responds in **English, Pidgin English, Yoruba, Igbo, Hausa,
French, Spanish, Indonesian, Chinese, Arabic** — and other languages the model can
handle.

Examples (try these):

- English: `"what's my balance?"`
- Pidgin: `"wetin dey my wallet?"`
- Yoruba: `"bawo ni balance mi?"`
- French: `"quel est mon solde?"`
- Spanish: `"¿cuál es mi saldo?"`

The system prompt in `src/ai/systemPrompt.ts` is multilingual and instructs the agent
to respond in the user's detected language.

---

## Private Key

To view a wallet's private key, ask the bot or use the button. The key is shown with a
one-tap hide button for security.

- Use **`/privatekey`** to reveal a wallet's private key.
- Keys are encrypted at rest with **AES-256-GCM** (see `src/wallet/crypto.ts`).
- The key is shown only via explicit request — never auto-displayed.
- One-tap hide button protects the message from lingering in chat history.

---

## Wallet Pickers and Confirm Flows

Many flows open a **wallet picker** (inline buttons with all your wallets) when the bot
needs to disambiguate which wallet to act on. After a flow stages an action
(send, swap, wrap, DCA execution, etc.), a **Confirm button** is shown and nothing
moves on-chain until you tap it. This is the universal pattern for any operation
that touches funds — and it is the second leg of the Verifiable Intent Pipeline:
**intent → TEE-attested parse → risk checks → user confirmation → on-chain tx → 0G Storage receipt → `/verify/:root` link**.

Tap Confirm → the action settles → the reply includes a `🧾 Receipt` link to
`/verify/:rootHash`. Use `/receipt` to list yours anytime.

---

## Stay Safe

- 🔐 *Never* share or paste your private key in DMs to anyone but this bot. The bot
  will never DM you to ask for it.
- When the bot asks for a private key (only `/import`), delete the message after
  sending.
- Every on-chain move (send / swap / wrap) shows a Confirm button.
- The bot sees everything you write; remember it's stored on 0G Storage forever.

---

## 🔗 See Also

- **[README.md](../README.md)** — overview, hero pitch, getting started
- **[0G-INTEGRATION.md](../0G-INTEGRATION.md)** — 0G stack depth (memory, compute, storage)
- **[DEPLOY.md](../DEPLOY.md)** — configuration + secrets + deployment
- **[docs/TESTING.md](./TESTING.md)** — test suite + CI + debug scripts
