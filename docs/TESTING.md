# Testing Reference

> **← Back to [README.md](../README.md)** for the project overview, hero pitch, and getting started.

This document is the **detailed testing reference** for Galileo — the test suite layout, CI
matrix, and debug scripts. The README links here from the Development section.

---

## Running Tests

```bash
# Watch mode (auto-restart on changes)
npm run dev

# Type-check only
npm run typecheck

# Run tests (discovers and runs every scripts/test-*.mjs)
npm test
```

The test runner (`scripts/run-tests.mjs`) auto-discovers every `scripts/test-*.mjs` file and
runs it in lexical order.

---

## Integration / Script Tests (`scripts/test-*.mjs`)

The `npm test` runner picks up every `scripts/test-*.mjs` file in lexical order:

| Script | What it tests |
|---|---|
| `scripts/test-handle-send-confirm.mjs` | Send Confirm/Cancel callback flow |
| `scripts/test-parse-send-text.mjs` | Send text parser (address + amount) |
| `scripts/test-parse-send-text-extended.mjs` | Extended send parser edge cases |
| `scripts/test-recipient-resolver.mjs` | `@handle` / `0x...` recipient resolution |
| `scripts/test-recipient-resolver-branches.mjs` | Resolver edge branches (`no_wallets`, self, etc.) |
| `scripts/test-send-command.mjs` | `/send` command end-to-end |
| `scripts/test-stage-send-message.mjs` | Send staging flow |
| `scripts/test-username-index.mjs` | Username index (case, trim, overwrite) |
| `scripts/test-portfolio-history.mjs` | Portfolio rendering + snapshot recording + P&L computation |

---

## Unit Tests (alongside source)

These live next to the modules they test and are run by `npm run typecheck` + the `mjs`
suite above:

| File | What it tests |
|---|---|
| `src/wallet/crypto.test.ts` | AES-256-GCM encrypt/decrypt round-trip and edge cases |
| `src/wallet/recipientResolver.test.ts` | `@handle` / `0x...` recipient resolution logic |
| `src/wallet/usernameIndex.test.ts` | Username index (case, trim, overwrite, hydrate) |
| `src/ai/memory.test.ts` | F1 memory store / search / prune |
| `src/handlers/sendUiHandlers.test.ts` | `/send` UI handler — deterministic parsing |

---

## Continuous Integration

`.github/workflows/ci.yml` runs on every push/PR to `Master`:

- **Lint + Typecheck** (`npm run typecheck`)
- **Test** (`npm test`)
- Matrix: **Node.js 20** and **Node.js 22**

The CI badge at the top of the [README](../README.md) reflects the latest run.

---

## Debug Scripts

One-off helpers for diagnosing specific issues. These are **not** part of the regular test
suite — they require manual invocation and (often) live credentials or a running 0G node.

| Script | Purpose |
|---|---|
| `scripts/compare-addresses.ts` | One-off helper that compares a 0G explorer URL's address against the operator wallet derived from `OPERATOR_PRIVATE_KEY`. Useful when debugging "why doesn't my tx show up under my wallet?" |
| `scripts/test-memory-diagnostic.ts` | Memory diagnostic — checks that 0G Storage snapshots are being written and read correctly |
| `scripts/test-compute.ts` | Compute connectivity — confirms the 0G Compute broker can be reached and responds to a small inference call |

Run with:

```bash
npx tsx scripts/compare-addresses.ts
npx tsx scripts/test-memory-diagnostic.ts
npx tsx scripts/test-compute.ts
```

---

## Adding a New Test

1. **Integration script test:** drop a new `scripts/test-*.mjs` file. The runner picks it up
   automatically. Keep it self-contained — no shared fixtures.
2. **Unit test (preferred for logic):** add `*.test.ts` next to the source file it tests.
   Make sure it's reachable by `npm run typecheck` and that it uses standard `node:test` or
   the project's chosen test runner conventions.

---

## 🔗 See Also

- **[README.md](../README.md)** — overview, hero pitch, getting started
- **[docs/USAGE.md](./USAGE.md)** — command reference + natural language examples
- **[0G-INTEGRATION.md](../0G-INTEGRATION.md)** — 0G stack depth (memory, compute, storage)
- **[DEPLOY.md](../DEPLOY.md)** — configuration + secrets + deployment
