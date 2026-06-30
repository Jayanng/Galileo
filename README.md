# 0G Memory Wallet

<div align="center">

**An AI-native Telegram wallet assistant built on the 0G blockchain stack**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![0G Chain](https://img.shields.io/badge/0G-Galileo%20Testnet-00D4AA)](https://0g.ai)
[![Telegram Bot](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram)](https://t.me/galileoOGbot)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Features](#features) • [Architecture](#architecture) • [Quick Start](#quick-start) • [Configuration](#configuration) • [Usage](#usage) • [Project Structure](#project-structure) • [Roadmap](#roadmap)

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

1. **User sends message** → `aiHandler` receives the text
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
| `OG_COMPUTE_FUND_AMOUNT` | ❌ | `0.05` | OG to top up the selected provider's inference sub-account at startup |
| `OG_COMPUTE_PROVIDER_ADDRESS` | ❌ | _(empty)_ | Optional explicit provider address; must still be a chatbot+TeeML service |
| `OG_INDEXER_RPC` | ❌ | `https://indexer-storage-testnet-turbo.0g.ai` | Storage indexer RPC |
| `OG_MEMORY_ENABLED` | ❌ | `true` | Enable F1 permanent memory |
| `OG_MEMORY_CONTEXT_WINDOW` | ❌ | `10` | Recent messages to inject as LLM context |
| `OG_MEMORY_SEARCH_LIMIT` | ❌ | `20` | Default search result limit |
| `OG_MEMORY_MAX_ENTRIES` | ❌ | `1000` | Max entries per user (oldest pruned) |
| `WALLET_GAS_DRIP` | ❌ | `0` | OG amount to drip to new wallets |
| `WALLET_STORE_PATH` | ❌ | `.data/wallets.json` | Local encrypted wallet store |

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
│
├── og/
│   ├── compute.ts            # 0G Compute Router client (OpenAI-compatible)
│   ├── chain.ts              # ethers v6 provider + operator wallet
│   ├── storage.ts            # 0G Storage (legacy KV, not used for memory)
│   └── fileStorage.ts        # 0G Storage File Mode (rolling snapshots)
│
├── ai/
│   ├── agent.ts              # Tool-calling agent loop (max 5 iterations)
│   ├── tools.ts              # Tool definitions (create_wallet, list_wallets, etc.)
│   ├── toolExecutor.ts       # Dispatches LLM tool calls to walletService
│   ├── systemPrompt.ts       # Bot persona, behavior rules, multilingual
│   └── memory.ts             # F1: permanent memory (0G Storage snapshots)
│
├── handlers/
│   ├── aiHandler.ts          # Natural language handler (AI agent entry point)
│   └── walletHandlers.ts      # Wallet command handlers + quick-action buttons
│
├── wallet/
│   ├── crypto.ts             # AES-256-GCM encrypt/decrypt
│   ├── crypto.test.ts        # Crypto unit test
│   ├── walletStore.ts        # Local + 0G-backed encrypted persistence
│   ├── walletService.ts      # Wallet generation, balance, rename
│   └── namingState.ts        # Wallet naming flow state management
│
└── util/
    └── qr.ts                 # Address → QR PNG generator
```

---

## Roadmap

| Feature | Status |
|---|---|
| **F4** On-Chain Wallet Generator | ✅ Complete |
| **F2** Conversational AI Agent | ✅ Complete |
| **F7** Multi-Language Support | ✅ Complete |
| **F1** Infinite Memory (0G Storage) | ✅ Complete |
| **UX** Quick-action buttons, loading states, message splitting | ✅ Complete |
| **F3** Verifiable AI Portfolio Advisor | ⏳ Planned |
| **F5** Verifiable AI Receipts | ⏳ Planned |
| **F6** Smart Link / Action Generator | ⏳ Planned |

---

## Development

```bash
# Watch mode (auto-restart on changes)
npm run dev

# Type-check only
npm run typecheck

# Run tests
npm test
```

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
