# Usage Reference

> **← Back to [README.md](../README.md)** for the project overview, hero pitch, and getting started.

This document is the **detailed usage reference** for Galileo — every command, every natural
language pattern, and every quick-action button. The README keeps a high-level overview; this
is where you come when you need the full reference.

---

## Quick-Action Buttons

After any response, tap the inline buttons:

```
[💰 Balance] [📬 Addresses] [➕ Wallet] [❓ Help]
```

- **💰 Balance** — Check all balances
- **📬 Addresses** — View wallet addresses
- **➕ Wallet** — Create a new wallet
- **❓ Help** — Show help with examples

---

## Commands (deterministic shortcuts)

For latency-sensitive or guaranteed-execution flows, the bot also accepts explicit commands.
These bypass the LLM tool-calling layer and always show a Confirm button before anything moves
on-chain:

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

> Deterministic parsing lives in `src/handlers/swapUiHandlers.ts` and
> `src/handlers/sendUiHandlers.ts`; fuzzy natural-language phrases fall through to the AI agent.

---

## Natural Language Examples

The AI agent understands your intent from plain English. A non-exhaustive sample:

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

---

## 🌍 Multi-Language Support

Galileo auto-detects and responds in: **English, Pidgin English, Yoruba, Igbo, Hausa, French,
Spanish, Indonesian, Chinese, Arabic** — and other languages the model can handle.

Examples (try these):

- English: `"what's my balance?"`
- Pidgin: `"wetin dey my wallet?"`
- Yoruba: `"bawo ni balance mi?"`
- French: `"quel est mon solde?"`
- Spanish: `"¿cuál es mi saldo?"`

The system prompt in `src/ai/systemPrompt.ts` is multilingual and instructs the agent to
respond in the user's detected language.

---

## 🔒 Private Key

To view a wallet's private key, ask the bot or use the button. The key is shown with a
one-tap hide button for security.

- Use `/privatekey` to reveal a wallet's private key
- Keys are encrypted at rest with **AES-256-GCM** (see `src/wallet/crypto.ts`)
- The key is shown only via explicit request — never auto-displayed
- One-tap hide button protects the message from lingering in chat history

---

## 📬 Wallet Pickers and Confirm Flows

Many flows open a **wallet picker** (inline buttons with all your wallets) when the bot
needs to disambiguate which wallet to act on. After a flow stages an action
(send, swap, wrap, etc.), a **Confirm button** is shown and nothing moves on-chain until
you tap it. This is the universal pattern for any operation that touches funds.

---

## 🔗 See Also

- **[README.md](../README.md)** — overview, hero pitch, getting started
- **[0G-INTEGRATION.md](../0G-INTEGRATION.md)** — 0G stack depth (memory, compute, storage)
- **[DEPLOY.md](../DEPLOY.md)** — configuration + secrets + deployment
- **[docs/TESTING.md](./TESTING.md)** — test suite + CI + debug scripts
