# 0G Memory Wallet

<div align="center">

**An AI-native Telegram wallet assistant built on the 0G blockchain stack**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![0G Chain](https://img.shields.io/badge/0G-Galileo%20Testnet-00D4AA)](https://0g.ai)
[![Telegram Bot](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram)](https://t.me/galileoOGbot)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![CI](https://github.com/Jayanng/Galileo/actions/workflows/ci.yml/badge.svg)](https://github.com/Jayanng/Galileo/actions)
[![0G Integration](https://img.shields.io/badge/0G_Integration-Reference-00D4AA)](0G-INTEGRATION.md)

[Features](#features) • [Architecture](#architecture) • [0G Integration Reference](0G-INTEGRATION.md) • [Quick Start](#quick-start) • [Configuration](#configuration) • [Usage](#usage) • [Project Structure](#project-structure) • [Roadmap](#roadmap)

<img src="docs/architecture.svg" alt="0G Memory Wallet Architecture" width="100%"/>

</div>

---

## Overview

0G Memory Wallet is a conversational Telegram bot that lets users manage cryptocurrency wallets using **natural language**. Built entirely on the 0G decentralized stack:

| Layer | Technology |
|---|---|
| **Chain** | 0G Galileo testnet (Chain ID 16602) |
| **Compute** | 0G Compute Network SDK (TEE-verifiable LLM inference) |
| **Storage** | 0G Storage (permanent, immutable memory + verification proofs) |
| **AI Model** | Qwen 2.5 Omni 7B (via 0G Compute) |

Users can create wallets, check balances, view addresses, rename wallets, and recall past activity — all by typing plain English (or Pidgin, Yoruba, French, and 7+ other languages).

---

## Features

### 💬 Natural Language Interface

No commands to learn. Just type what you want:

```
"create me a wallet"
"what's my balance?"
"show my wallets"
"rename my savings wallet"
"what did I do last week?"
```

The AI agent understands your intent and executes the appropriate actions.

### 🧠 Permanent Memory (F1)

Every interaction is permanently stored on 0G Storage. The bot remembers:

- All past messages and conversations
- Wallet creation history with timestamps
- Previous tool calls and their results
- On-chain transactions

Memory survives bot restarts — ask "what did I do yesterday?" and get an accurate answer.

### 👛 Multi-Wallet Management

- Create multiple named wallets per user
- View wallet addresses with QR codes
- Check OG token balances
- Rename wallets anytime
- View private keys securely (one-tap hide)

### 🌍 Multi-Language Support

Auto-detects and responds in: English, Pidgin English, Yoruba, Igbo, Hausa, French, Spanish, Indonesian, Chinese, Arabic.

### 🔒 Security

- Private keys encrypted at rest (AES-256-GCM)
- Keys revealed only via explicit `/privatekey` command
- Operator wallet handles gas and storage writes
- Per-user wallets are independently generated

### 🌿 Self-Healing In-Memory Registry

The Telegram `@username → userId` registry lives in process memory as the **single source of truth at runtime** — every incoming message refreshes it, so the index rebuilds organically after every restart. Zero per-message latency, zero consistency checks, zero restoration drills.

When 0G Storage is enabled (`OG_STORAGE_ENABLED=true`), an **additive persistence layer** keeps the registry warm across restarts: `hydrate()` loads the latest snapshot at startup, and every `record()` fires a non-blocking `uploadJson` of the current Map state. The in-memory API (`record()` / `lookup()` / `count()` / `clear()`) is unchanged — persistence is opt-in and falls back to the original behavior when disabled, so the design degrades cleanly if 0G Storage is unreachable.

See [0G-INTEGRATION.md §4](0G-INTEGRATION.md#4-username-registry-handle--userid-resolution) for the layered architecture diagram and the design rationale.

### 🔐 TEE-Verifiable Inference

Every AI reply carries a verification footer:

```
✅ Verified in TEE — chatID: `0xabcd123456…ef5678`
```

The 0G Compute Network SDK signs each request and verifies the provider's TEE-signed response. Verified chat IDs are persisted to 0G Storage alongside your conversation history — send `/proof` to see the last 10.

### ⚡ Progressive UX

- Loading states for long operations
- Quick-action buttons for common tasks
- Smart message splitting (handles >4096 character responses)
- Typing indicators during LLM inference

### ⏰ Scheduled Intents (DCA + Alerts)

Recurring on-chain actions and price-trigger notifications, persisted across restarts:

```
"dca 1 OG into USDC weekly"          → DCA intent (recurring swap on schedule)
"alert me if OG drops below $1"      → Alert intent (one-shot Telegram message on price condition)
```

- **DCA** — Say "dca X <from> into <to> every <schedule>" (e.g. "every 6 hours", "weekly", "daily"). The bot's in-process worker ticks every 30s and fires due swaps automatically, signing with the user's decrypted key. Supported paths today: OG→USDC, OG→USDT, OG→WOG (wrap), WOG→OG (unwrap).
- **Alerts** — "alert me if <symbol> goes <operator> <price>" (e.g. "below $1", "above $100k"). Fires once when the condition is met, then status flips to `fired`. Stablecoins (USDC/USDT) are checked without an API call; arbitrary CoinGecko IDs (e.g. "bitcoin", "ethereum") are supported.
- **Persistence** — All intents live in the same local-mirror + 0G Storage pattern as wallets and memory. The worker re-hydrates on every bot start, so DCAs survive restarts mid-cycle.
- **Manage** — `/intents` shows your active intents with inline Cancel and Pause/Resume buttons. The worker skips paused intents and removes cancelled ones.

See [`src/intents/`](./src/intents) for the engine and [`scripts/test-intent-*.mjs`](./scripts) for unit tests.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Telegram                           │
│                    (grammY Bot)                          │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                   handler layer                          │
│                                                         │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ walletHandlers  │  │         aiHandler             │  │
│  │ (commands +     │  │  (natural language routing)   │  │
│  │  button taps)   │  │                               │  │
│  └────────┬────────┘  └──────────────┬────────────────┘  │
└───────────┼──────────────────────────┼────────────────────┘
            │                          │
┌───────────▼──────────────────────────▼────────────────────┐
│                    agent layer                             │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              runAgent() loop                          │ │
│  │  1. Build system prompt + memory context             │ │
│  │  2. Call 0G Compute (LLM) with tool definitions      │ │
│  │  3. Execute tool calls via toolExecutor               │ │
│  │  4. Loop until LLM produces final answer (max 5)     │ │
│  │  5. Persist interaction to 0G Storage                │ │
│  └──────────────────────────────────────────────────────┘ │
│                           │                                │
│  ┌────────────────────────▼───────────────────────────┐   │
│  │  tools.ts · toolExecutor.ts · systemPrompt.ts      │   │
│  │  memory.ts · fileStorage.ts                        │   │
│  └────────────────────────────────────────────────────┘   │
└──────────────────────────┬─────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────┐
│                   service layer                             │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ walletService │  │   crypto.ts  │  │    walletStore   │  │
│  │ (F4 wallet    │  │ AES-256-GCM  │  │  local encrypted  │  │
│  │  generator)   │  │ encrypt/     │  │  persistence     │  │
│  │               │  │ decrypt      │  │                  │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                   0G blockchain layer                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  chain.ts    │  │  compute.ts  │  │  fileStorage.ts  │  │
│  │ ethers v6    │  │ OpenAI SDK   │  │ 0G Storage File  │  │
│  │ RPC provider │  │ 0G Compute   │  │ Indexer          │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User sends message** → `aiHandler` receives the text; bot.ts middleware passively records `@username` into the [Username Index](0G-INTEGRATION.md#4-username-registry-handle--userid-resolution)
2. **History loaded** → Past interactions fetched from 0G Storage (or in-memory cache)
3. **Memory context built** → Recent + earliest entries formatted for LLM context
4. **LLM inference** → 0G Compute processes the prompt with tool definitions
5. **Tool execution** → If LLM requests a tool (create wallet, check balance, etc.), `toolExecutor` dispatches it
6. **Result loop** → Tool results fed back to LLM for final response
7. **Persistence** → Interaction saved to 0G Storage (best-effort, non-blocking)
8. **Reply** → Response sent to user with quick-action buttons

---

## Tech Stack

| Category | Technology |
|---|---|
| **Runtime** | Node.js ≥20, TypeScript 5.7 |
| **Bot Framework** | grammY (Telegram) |
| **Blockchain** | ethers v6, 0G Galileo testnet |
| **AI Inference** | 0G Compute Router (OpenAI-compatible) |
| **AI Model** | Qwen 2.5 Omni 7B |
| **Storage** | 0G Storage (File Mode) |
| **Encryption** | AES-256-GCM |
| **Validation** | zod |
| **Dev Tools** | tsx (TypeScript executor), tsd (typecheck) |

---

## Quick Start

### Prerequisites

- **Node.js ≥20** (developed on 22)
- **Telegram bot token** — get one from [@BotFather](https://t.me/BotFather)
- **Operator wallet** — funded with testnet OG from the [0G faucet](https://faucet.0g.ai)
- **0G Compute API key** — get one at [pc.testnet.0g.ai](https://pc.testnet.0g.ai) (deposit ~0.05 OG to activate)

### Installation

```bash
# Clone the repository
git clone https://github.com/Jayanng/Galileo.git
cd Galileo

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

### Configuration

Edit `.env` with your credentials:

```env
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
OPERATOR_PRIVATE_KEY=your_operator_wallet_key
WALLET_ENCRYPTION_KEY=a_long_random_secret_key_16_chars_min
OG_COMPUTE_API_KEY=your_key_from_pc_testnet_0g_ai
```

See [Configuration Reference](#configuration-reference) for all available options.

### Run

```bash
# Development (watch mode)
npm run dev

# Production
npm start

# Type-check
npm run typecheck

# Run tests
npm test
```

### First Use

Open Telegram and message your bot:

```
"create me a wallet"
```

The bot will create a wallet, show you the address and private key, and ask you to name it. That's it — you're set.

---

## Configuration Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Bot token from [@BotFather](https://t.me/BotFather) |
| `OPERATOR_PRIVATE_KEY` | ✅ | — | 32-byte hex private key (with or without `0x`) |
| `WALLET_ENCRYPTION_KEY` | ✅ | — | AES-256-GCM passphrase for key encryption |
| `OG_COMPUTE_API_KEY` | ✅ | — | API key from [pc.testnet.0g.ai](https://pc.testnet.0g.ai) |
| `OG_RPC` | ❌ | `https://evmrpc-testnet.0g.ai` | 0G chain RPC endpoint |
| `OG_CHAIN_ID` | ❌ | `16602` | 0G Galileo chain ID |
| `OG_COMPUTE_BASE_URL` | ❌ | `https://router-api-testnet.integratenetwork.work/v1` | Compute Router endpoint (fallback only) |
| `OG_COMPUTE_MODEL` | ❌ | `qwen/qwen2.5-omni-7b` | LLM model for inference |
| `OG_COMPUTE_FALLBACK` | ❌ | `false` | Skip the official 0G Compute SDK and use the legacy router URL. No TEE verification. |
| `OG_COMPUTE_FUND_AMOUNT` | ❌ | `3` | OG to top up the selected provider's inference sub-account at startup |
| `OG_COMPUTE_PROVIDER_ADDRESS` | ❌ | _(empty)_ | Optional explicit provider address; must still be a chatbot+TeeML service |
| `OG_INDEXER_RPC` | ❌ | `https://indexer-storage-testnet-turbo.0g.ai` | Storage indexer RPC |
| `OG_MEMORY_ENABLED` | ❌ | `true` | Enable F1 permanent memory |
| `OG_MEMORY_CONTEXT_WINDOW` | ❌ | `10` | Recent messages to inject as LLM context |
| `OG_MEMORY_SEARCH_LIMIT` | ❌ | `20` | Default search result limit |
| `OG_MEMORY_MAX_ENTRIES` | ❌ | `1000` | Max entries per user (oldest pruned) |
| `WALLET_GAS_DRIP` | ❌ | `0` | OG amount to drip to new wallets |
| `WALLET_STORE_PATH` | ❌ | `.data/wallets.json` | Local encrypted wallet store |

> ⚠️ **Secrets in `.env`** — Your local `.env` contains real private keys and deployed-contract addresses. It is gitignored (so it won't be pushed), but it is still sensitive. Never copy it to cloud-sync folders, backups, or share its contents in chat/issues. If it leaks, rotate immediately via `fly secrets set`. See [DEPLOY.md § Secrets handling](DEPLOY.md#secrets-handling) for the full checklist.

---

## Usage

### Natural Language Examples

| You Say | Bot Does |
|---|---|
| *"create me a wallet"* | Generates a new wallet, shows key + address, prompts for name |
| *"create a wallet called savings"* | Creates a wallet named "savings" |
| *"what's my balance?"* | Shows OG balance for all wallets |
| *"show my wallets"* | Lists all wallets with addresses and names |
| *"show my address"* | Shows wallet picker, then address + QR |
| *"rename my wallet to main"* | Renames the specified wallet |
| *"what did I do yesterday?"* | Searches permanent memory for yesterday's activity |
| *"what's my first wallet?"* | Recalls the earliest wallet creation from memory |
| *"send 0.1 OG to @tebasv2"* | Resolves @tebasv2 to their active wallet and shows a Confirm button |
| *"/send 0xAbC... 0.1"* | Stages a send to that exact address |
| *"swap 0.1 OG to USDC"* | Stages a token swap and shows a Confirm button |
| *"wrap 1 OG"* | Stages a wrap (OG → WOG) and shows a Confirm button |
| *"what's my portfolio worth?"* | Shows all wallets with USD prices + grand total; records a daily snapshot |
| *"how much is bitcoin?"* | Quick CoinGecko USD price lookup |
| *"how many transactions have I done?"* | Returns total tx count, breakdown by type, and total volume per token (via the `transaction_stats` tool) |
| *"show my P&L this week"* | Renders a daily snapshot table with % change vs the baseline |

### Commands (deterministic shortcuts)

For latency-sensitive or guaranteed-execution flows, the bot also accepts explicit commands. These bypass the LLM tool-calling layer and always show a Confirm button before anything moves on-chain:

| Command | What it does |
|---|---|
| `/portfolio` | All wallets with USD prices + grand total (records a daily snapshot) |
| `/price <symbol\|coingecko-id>` | Quick USD price lookup (e.g. `/price bitcoin`, `/price USDC`) |
| `/history [day\|week\|month]` | Portfolio P&L over time from daily snapshots |
| `/proof` | List your last 10 TEE-verified chats |
| `/balance` | OG balance for all wallets |
| `/wallet` | Create a new wallet |
| `/address` | List wallet addresses |
| `/privatekey` | Reveal a wallet's private key (one-tap hide) |
| `/wrap <amount>` | Wrap OG → WOG |
| `/unwrap <amount>` | Unwrap WOG → OG |
| `/swap <amount> <FROM> <TO>` | Token swap (e.g. `/swap 0.1 OG USDC`); opens the Swap menu with no args |
| `/send <recipient> <amount>` | Send OG to `@handle` or `0x...` address |
| `/intents` | List your DCA + alert intents with Cancel/Pause buttons |
| `/cancel <id>` | Cancel a scheduled intent by id (or use the inline button) |
| `/pause <id>` | Pause or resume a scheduled intent by id (or use the inline button) |

> Deterministic parsing lives in `src/handlers/swapUiHandlers.ts` and `src/handlers/sendUiHandlers.ts`; fuzzy natural-language phrases fall through to the AI agent.

### Quick-Action Buttons

After any response, tap the inline buttons:

```
[💰 Balance] [📬 Addresses] [➕ Wallet] [❓ Help]
```

- **💰 Balance** — Check all balances
- **📬 Addresses** — View wallet addresses
- **➕ Wallet** — Create a new wallet
- **❓ Help** — Show help with examples

### Private Key

To view a wallet's private key, ask the bot or use the button. The key is shown with a one-tap hide button for security.

---

## Project Structure

```
src/
├── index.ts                  # Entry point: load config, start bot
├── config.ts                 # Zod-validated environment config
├── bot.ts                    # grammY bot setup + routing
├── health.ts                 # /health + /proofs HTTP endpoints
├── faq.ts                    # /help FAQ text
│
├── og/
│   ├── compute.ts            # 0G Compute Router client (OpenAI-compatible, fallback)
│   ├── computeBroker.ts      # 0G Compute broker (TEE-verifiable inference, default)
│   ├── chain.ts              # ethers v6 provider + operator wallet
│   ├── fileStorage.ts        # 0G Storage File Mode (rolling snapshots)
│   ├── portfolio.ts          # Portfolio aggregation + USD pricing + snapshot types
│   ├── prices.ts             # CoinGecko USD price feed (60s cache)
│   ├── dex.ts                # Uniswap-V2 router/factory wrappers
│   ├── erc20.ts              # ERC-20 helpers (allowance, transfer)
│   └── wog.ts                # WOG (WETH9 clone) wrap/unwrap helpers
│
├── ai/
│   ├── agent.ts              # Tool-calling agent loop (max 5 iterations)
│   ├── tools.ts              # Tool definitions (15 tools: create_wallet, list_wallets, send_og, prepare_swap, get_price_usd, transaction_stats, …)
│   ├── toolExecutor.ts       # Dispatches LLM tool calls to services
│   ├── systemPrompt.ts       # Bot persona, behavior rules, multilingual
│   ├── memory.ts             # F1: permanent memory (0G Storage snapshots)
│   └── memory.test.ts
│
├── analytics/
│   └── snapshot.ts           # Daily portfolio snapshots (local file, /history backend)
│
├── handlers/
│   ├── aiHandler.ts          # Natural language handler (AI agent entry point)
│   ├── walletHandlers.ts     # Wallet command handlers + quick-action buttons
│   ├── portfolioHandlers.ts  # /portfolio, /price, /history
│   ├── proofHandler.ts       # /proof command (recent TEE-verified chats)
│   ├── swapHandlers.ts       # Swap Confirm/Cancel callbacks
│   ├── swapUiHandlers.ts     # /swap command + deterministic swap parsing
│   ├── sendHandlers.ts       # Send Confirm/Cancel callbacks
│   ├── sendUiHandlers.ts     # /send command + deterministic send parsing
│   └── sendUiHandlers.test.ts
│
├── wallet/
│   ├── crypto.ts             # AES-256-GCM encrypt/decrypt
│   ├── crypto.test.ts        # Crypto unit test
│   ├── walletStore.ts        # Local + 0G-backed encrypted persistence
│   ├── walletService.ts      # Wallet generation, balance, rename, send, swap
│   ├── activeWallet.ts       # Active-wallet selection per user
│   ├── namingState.ts        # Wallet naming flow state management
│   ├── swapState.ts          # Per-user swap-amount waiting state
│   ├── sendState.ts          # Per-user send-amount waiting state
│   ├── recipientResolver.ts  # @handle / 0x... → wallet address resolution
│   ├── recipientResolver.test.ts
│   ├── usernameIndex.ts      # @handle → userId index (in-memory)
│   └── usernameIndex.test.ts
│
├── swap/
│   ├── swapService.ts        # Swap orchestration (prepare/execute)
│   └── pendingSwap.ts        # Pending-swap state for Confirm buttons
│
├── send/
│   ├── sendService.ts        # Send orchestration (prepare/execute)
│   └── pendingSend.ts        # Pending-send state for Confirm buttons
│
└── util/
    └── qr.ts                 # Address → QR PNG generator
```

### AI Tools (summary)

The agent exposes 15 LLM-callable tools in `src/ai/tools.ts`. Highlights:

- `transaction_stats` — On-chain tx count, recorded count, breakdown by type, and volume per token. Used when the user asks "how many transactions have I done?" or "what's my total volume?".
- `get_price_usd` — USD price for any tracked token (OG, WOG, USDC, USDT) or any CoinGecko id.
- `prepare_swap` — Stages a wrap/unwrap or DEX swap; never executes without a Confirm button.
- `search_history` / `get_recent_proofs` — Memory and TEE-proof retrieval.
- `send_og` / `create_wallet` / `list_wallets` / `rename_wallet` / etc. — Wallet CRUD.
- `dca_create` / `alert_create` / `list_intents` / `cancel_intent` / `pause_intent` / `resume_intent` — Scheduled intents (DCA + alerts). Created intents are picked up by the in-process worker every 30s.

---

## Roadmap

| Feature | Status |
|---|---|
| **F4** On-Chain Wallet Generator | ✅ Complete |
| **F2** Conversational AI Agent | ✅ Complete |
| **F7** Multi-Language Support | ✅ Complete |
| **F1** Infinite Memory (0G Storage) | ✅ Complete |
| **UX** Quick-action buttons, loading states, message splitting | ✅ Complete |
| **F3** Verifiable AI Portfolio Advisor | ✅ Complete (`/portfolio`, `/price`, `/history` + `transaction_stats` tool) |
| **F5** Verifiable AI Receipts | ⏳ Planned |
| **F6** Smart Link / Action Generator | ⏳ Planned |
| **DEX** Demo Uniswap-V2 + mock USDC/USDT on 0G Galileo | ✅ Complete |
| **Username Registry Persistence** | ✅ Complete (in-memory + optional 0G Storage layer, gated by `OG_STORAGE_ENABLED`) |
| **Scheduled Intents** DCA + price alerts via polling worker | ✅ Complete (`/intents`, `/cancel`, `/pause` + 6 AI tools; ticks every 30s, survives restarts via 0G Storage) |

---

## Development

```bash
# Watch mode (auto-restart on changes)
npm run dev

# Type-check only
npm run typecheck

# Run tests (discovers and runs every scripts/test-*.mjs)
npm test
```

### Tests

The test runner (`scripts/run-tests.mjs`) auto-discovers every `scripts/test-*.mjs` file and runs it in lexical order. Current suite:

- `scripts/test-handle-send-confirm.mjs` — Send Confirm/Cancel callback flow
- `scripts/test-parse-send-text.mjs` — Send text parser (address + amount)
- `scripts/test-parse-send-text-extended.mjs` — Extended send parser edge cases
- `scripts/test-recipient-resolver.mjs` — @handle / 0x... recipient resolution
- `scripts/test-recipient-resolver-branches.mjs` — Resolver edge branches (no_wallets, self, etc.)
- `scripts/test-send-command.mjs` — `/send` command end-to-end
- `scripts/test-stage-send-message.mjs` — Send staging flow
- `scripts/test-username-index.mjs` — Username index (case, trim, overwrite)
- `scripts/test-portfolio-history.mjs` — Portfolio rendering + snapshot recording + P&L computation

Unit tests alongside source (run by `npm run typecheck` + the mjs suite):
- `src/wallet/crypto.test.ts`
- `src/wallet/recipientResolver.test.ts`
- `src/wallet/usernameIndex.test.ts`
- `src/ai/memory.test.ts`
- `src/handlers/sendUiHandlers.test.ts`

### Continuous Integration

`.github/workflows/ci.yml` runs on every push/PR to `Master`:
- **Lint + Typecheck** (`npm run typecheck`)
- **Test** (`npm test`)
- Matrix: Node.js 20 and 22

The badge at the top of this README reflects the latest CI run.

### Debug Scripts

- `scripts/compare-addresses.ts` — One-off helper that compares a 0G explorer URL's address against the operator wallet derived from `OPERATOR_PRIVATE_KEY`. Useful when debugging "why doesn't my tx show up under my wallet?".

### Testing Memory

```bash
# Memory diagnostic
npx tsx scripts/test-memory-diagnostic.ts

# Compute connectivity
npx tsx scripts/test-compute.ts
```

---

## License

[MIT](LICENSE)

---

<div align="center">
Built for the 0G ecosystem · <a href="https://0g.ai">0g.ai</a>
</div>
