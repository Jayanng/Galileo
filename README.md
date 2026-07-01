# 👋 Galileo – Your AI Wallet Friend on Telegram

<div align="center">

### Talk to your wallet like you talk to a friend.

**No complicated commands. No confusing buttons.**
**Just type normal words on your phone and Galileo does the rest.**

Whether you are young or old, new to crypto or experienced — **Galileo is made for you.**
It feels like your normal daily chats online.

Create wallets, check balances, send money, set reminders — all by simple talking.

**Built on 0G so your chat history and memories are saved forever and stay private.**

Safe, fast, and always ready when you need it.

---

### 🎬 **[Try Galileo Now →](https://t.me/galileoOGbot)**

Open Telegram, message `@galileoOGbot`, and type:

```
create me a wallet
```

Your wallet is ready in seconds.

<!-- TODO: Replace with screenshot of a real Galileo conversation (e.g. "create me a wallet" → response). Save as docs/screenshots/welcome.png or similar. -->

<!-- TODO: Replace with a short GIF or video showing a full Galileo conversation (create wallet → check balance → send → confirm). Save as docs/screenshots/demo.gif or demo.mp4. -->

---

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![0G Chain](https://img.shields.io/badge/0G-Galileo%20Testnet-00D4AA)](https://0g.ai)
[![Telegram Bot](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram)](https://t.me/galileoOGbot)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![CI](https://github.com/Jayanng/Galileo/actions/workflows/ci.yml/badge.svg)](https://github.com/Jayanng/Galileo/actions)
[![0G Integration](https://img.shields.io/badge/0G_Integration-Reference-00D4AA)](0G-INTEGRATION.md)
[![Live on Telegram](https://img.shields.io/badge/Live%20on-Telegram-26A5E4?logo=telegram)](https://t.me/galileoOGbot)
[![Multi--Language](https://img.shields.io/badge/Languages-10%2B-00D4AA)]()
[![Deployed on Fly.io](https://img.shields.io/badge/Deployed-Fly.io-FF6B6B?logo=fly)](https://fly.io)

[Features](#what-galileo-does) · [Why Galileo](#why-galileo-exists) · [Quick Start](#quick-start) · [Architecture](#how-its-built) · [0G Integration Reference](0G-INTEGRATION.md) · [Usage Reference](docs/USAGE.md) · [Testing Reference](docs/TESTING.md) · [Deploy Guide](DEPLOY.md) · [Project Structure](#project-structure) · [Roadmap](#roadmap)

<img src="docs/architecture.svg" alt="Galileo Architecture" width="100%"/>

</div>

---

## 🌍 Why Galileo Exists

Most wallets ask you to learn a new language: command names, hex addresses, gas fees,
"approvals," "slippage." **Galileo asks you to just talk.**

And it's the only wallet that can credibly do all of this:

> **A wallet you can talk to in any language — where every word is verified in a TEE and
> every memory is permanent on 0G Storage. No other stack can credibly offer all three.**

- **Talk to it in any language** — Yoruba, Pidgin, Igbo, Hausa, French, Spanish, English,
  and 3+ more. The first wallet built for the next billion users.
- **Every word, verified** — every AI reply is signed by a hardware enclave (TEE) on 0G
  Compute. The proof lives on-chain. Tap `/proof` to see your last 10 verified chats.
- **Every memory, permanent** — every interaction lives forever on 0G Storage. Ask
  *"what did I do last week?"* and get the right answer — even months later.

This is what makes Galileo different from Grimoire's more technical, developer-leaning
positioning. **Galileo is for everyone.**

---

## ✨ Why Galileo Feels Easy

- **Just chat naturally:** "Create a new savings wallet" or "What's my balance?"
- **Works in your language** (English, Pidgin, Yoruba, French, and many more).
- **Remembers everything:** Ask "What did I do last week?" and it tells you.
- **Safe and simple:** Private keys stay hidden unless you ask.
- **Runs on your phone** — no new apps to learn.

**Galileo turns crypto into something simple and fun, like sending a normal message.**

---

## 😌 No More Crypto Stress

Forget confusing websites and scary errors. Galileo removes the hard parts:

- **No need to copy long addresses.** Send money with a Telegram `@username`.
- **No fear of losing your history** — everything is saved safely on 0G.
- **Works even if you are new to crypto or in a hurry.**

Just open Telegram and talk. That's it.

---

## 💡 What Galileo Does

Galileo is feature-rich under the hood, but the surface is one thing: **type what you want
and it happens.** Here's a quick tour:

### 💬 Just Talk

No commands to learn. The AI agent understands plain English (and Pidgin, Yoruba, French,
and 7+ more languages):

```
"create me a wallet"
"what's my balance?"
"send 0.1 OG to @tebasv2"
"what did I do last week?"
```

### 👛 Multi-Wallet Management — Your Wallets, Your Way

- Create multiple named wallets per user
- View addresses with QR codes
- Check OG + WOG + USDC + USDT balances
- Rename wallets anytime
- View private keys securely (one-tap hide)

### ⏰ Scheduled Intents (DCA + Alerts)

Set-and-forget money habits, just by talking:

```
"dca 1 OG into USDC weekly"          → weekly swap on schedule
"alert me if OG drops below $1"      → Telegram ping when price hits
```

- **DCA** — *"dca X <from> into <to> every <schedule>"*. Bot's worker ticks every 30s.
- **Alerts** — *"alert me if <symbol> goes <operator> <price>"*. Fires once when met.
- **Manage** — `/intents`, `/cancel`, `/pause` with inline buttons.

### 💱 Swap, Send, Wrap

- **Swap** OG↔USDC↔USDT↔WOG via DEX. *"Swap 0.1 OG to USDC"* → confirm → done.
- **Send** to `@username` or `0x…` addresses with a Confirm button before any on-chain move.
- **Wrap/Unwrap** OG↔WOG. *"Wrap 1 OG"* or `/wrap 1`.

### 📊 Portfolio + P&L

- *"What's my portfolio worth?"* — All wallets, USD prices, grand total.
- *"Show my P&L this week"* — Daily snapshot table with % change.
- *"How many transactions have I done?"* — Total count, breakdown by type, volume per token.

### 🧠 Permanent Memory (F1)

Every interaction is permanently stored on 0G Storage. The bot remembers:

- All past messages and conversations
- Wallet creation history with timestamps
- Previous tool calls and their results
- On-chain transactions

Memory survives bot restarts. Ask *"what did I do yesterday?"* and get the right answer.

### 🔐 TEE-Verified Replies

Every AI reply carries a verification footer:

```
✅ Verified in TEE — chatID: `0xabcd123456…ef5678`
```

The 0G Compute Network SDK signs each request and verifies the provider's TEE-signed
response. Verified chat IDs are persisted to 0G Storage alongside your conversation history —
send `/proof` to see the last 10.

### 🔒 Security

- Private keys encrypted at rest (**AES-256-GCM**)
- Keys revealed only via explicit `/privatekey` command
- Operator wallet handles gas and storage writes
- Per-user wallets are independently generated

### 🌿 Self-Healing In-Memory Registry

The Telegram `@username → userId` registry lives in process memory as the **single source
of truth at runtime** — every incoming message refreshes it, so the index rebuilds organically
after every restart. Zero per-message latency, zero consistency checks, zero restoration drills.

When 0G Storage is enabled (`OG_STORAGE_ENABLED=true`), an **additive persistence layer**
keeps the registry warm across restarts. The in-memory API (`record()` / `lookup()` /
`count()` / `clear()`) is unchanged — persistence is opt-in and falls back to the original
behavior when disabled.

See [0G-INTEGRATION.md §3](0G-INTEGRATION.md#3-username-registry)
for the layered architecture diagram and design rationale.

### ⚡ Progressive UX

- Loading states for long operations
- Quick-action buttons for common tasks
- Smart message splitting (handles >4096 character responses)
- Typing indicators during LLM inference

### 🤖 AI Tools (the depth under the hood)

The agent exposes **15 LLM-callable tools** in `src/ai/tools.ts`. Highlights:

- `transaction_stats` — On-chain tx count, breakdown by type, volume per token
- `get_price_usd` — USD price for any tracked token (OG, WOG, USDC, USDT) or any CoinGecko id
- `prepare_swap` — Stages a wrap/unwrap or DEX swap; never executes without Confirm
- `search_history` / `get_recent_proofs` — Memory and TEE-proof retrieval
- `send_og` / `create_wallet` / `list_wallets` / `rename_wallet` / etc. — Wallet CRUD
- `dca_create` / `alert_create` / `list_intents` / `cancel_intent` / `pause_intent` /
  `resume_intent` — Scheduled intents (DCA + alerts)

---

## 🚀 Quick Start

### Prerequisites

- **Node.js ≥20** (developed on 22)
- **Telegram bot token** — get one from [@BotFather](https://t.me/BotFather)
- **Operator wallet** — funded with testnet OG from the [0G faucet](https://faucet.0g.ai)
- **0G Compute API key** — get one at [pc.testnet.0g.ai](https://pc.testnet.0g.ai) (deposit
  ~0.05 OG to activate)

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

### Required Environment Variables

The four must-haves are:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
OPERATOR_PRIVATE_KEY=your_operator_wallet_key
WALLET_ENCRYPTION_KEY=a_long_random_secret_key_16_chars_min
OG_COMPUTE_API_KEY=your_key_from_pc_testnet_0g_ai
```

**📖 Full configuration reference (every variable + default + description):**
**[DEPLOY.md → Configuration Reference](DEPLOY.md#configuration-reference)**

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
create me a wallet
```

The bot will create a wallet, show you the address and private key, and ask you to name it.
That's it — you're set.

---

## 🏗 How It's Built

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
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User sends message** → `aiHandler` receives the text; `bot.ts` middleware passively
   records `@username` into the [Username Index](0G-INTEGRATION.md#3-username-registry)
2. **History loaded** → Past interactions fetched from 0G Storage (or in-memory cache)
3. **Memory context built** → Recent + earliest entries formatted for LLM context
4. **LLM inference** → 0G Compute processes the prompt with tool definitions
5. **Tool execution** → If LLM requests a tool (create wallet, check balance, etc.),
   `toolExecutor` dispatches it
6. **Result loop** → Tool results fed back to LLM for final response
7. **Persistence** → Interaction saved to 0G Storage (best-effort, non-blocking)
8. **Reply** → Response sent to user with quick-action buttons

### Tech Stack

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

### Overview — The Stack at a Glance

| Layer | Technology |
|---|---|
| **Chain** | 0G Galileo testnet (Chain ID 16602) |
| **Compute** | 0G Compute Network SDK (TEE-verifiable LLM inference) |
| **Storage** | 0G Storage (permanent, immutable memory + verification proofs) |
| **AI Model** | Qwen 2.5 Omni 7B (via 0G Compute) |

Users can create wallets, check balances, view addresses, rename wallets, and recall past
activity — all by typing plain English (or Pidgin, Yoruba, French, and 7+ other languages).

---

## 📚 Documentation Map

This README is the **front door** — the hero, pitch, and high-level feature overview.
For deep reference material, the docs are one click away:

| What you want | Where to go |
|---|---|
| **Every command + natural language pattern + multi-language examples** | **[docs/USAGE.md](docs/USAGE.md)** |
| **Test suite, CI matrix, debug scripts** | **[docs/TESTING.md](docs/TESTING.md)** |
| **Full env-var reference + secrets + deploy to Fly.io** | **[DEPLOY.md](DEPLOY.md)** |
| **0G stack depth (memory, compute, storage, integration patterns)** | **[0G-INTEGRATION.md](0G-INTEGRATION.md)** |

---

## 📂 Project Structure

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

---

## 🧭 Roadmap

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
| **Telegram Mini-App Dashboard** — Portfolio, history, proof as embedded WebApp | ⏳ Planned |
| **Multi-Agent Sub-Personalities** — Trader/Analyst/Security/Tax modes with auto-routing | ⏳ Planned |
| **Voice Messages** — Talk instead of typing | ⏳ Planned |
| **Family & Group Wallets** — Shared wallets for family and groups | ⏳ Planned |
| **Smart Savings Plans** — Automated recurring savings by talking | ⏳ Planned |
| **Multi-Chain Support** — Send money across different networks | ⏳ Planned |
| **Personal AI Tips** — Gentle spending and usage insights | ⏳ Planned |
| **One-Tap Proof** — Share verified 0G transactions easily | ⏳ Planned |

---

## 🛠 Development

```bash
# Watch mode (auto-restart on changes)
npm run dev

# Type-check only
npm run typecheck

# Run tests (discovers and runs every scripts/test-*.mjs)
npm test
```

**📖 Full testing reference (test files, CI matrix, debug scripts):**
**[docs/TESTING.md](docs/TESTING.md)**

### Continuous Integration

`.github/workflows/ci.yml` runs on every push/PR to `Master`:

- **Lint + Typecheck** (`npm run typecheck`)
- **Test** (`npm test`)
- Matrix: **Node.js 20** and **Node.js 22**

The badge at the top of this README reflects the latest CI run. Full CI details and the
debug scripts inventory live in **[docs/TESTING.md](docs/TESTING.md)**.

---

## 📜 License

[MIT](LICENSE)

---

<div align="center">
Built with ❤️ for the 0G ecosystem · <a href="https://0g.ai">0g.ai</a><br/>
<sub>Galileo is your AI wallet friend on Telegram. Built for everyone.</sub>
</div>
