# Deploying to Fly.io

The bot uses Telegram **long-polling**, so it runs as a single always-on worker (no public
HTTP). Wallet data is persisted on a Fly **volume** mounted at `/data`, so it survives
deploys and restarts.

## One-time setup

1. Install flyctl: https://fly.io/docs/flyctl/install/ — then `fly auth login`.
2. Pick a **globally-unique** app name and set it in `fly.toml` (`app = "..."`).
3. Create the app:
   ```bash
   fly apps create <app-name>
   ```
4. Create the volume in the **same region** as `primary_region`:
   ```bash
   fly volumes create galileo_data --size 1 --region iad --app <app-name>
   ```
5. Set secrets (these stay out of the image and the repo). **Use freshly-rotated values** —
   the ones currently in git history are compromised:
   ```bash
   fly secrets set \
     TELEGRAM_BOT_TOKEN=xxxxx \
     OPERATOR_PRIVATE_KEY=0x... \
     WALLET_ENCRYPTION_KEY=xxxxx \
     OG_COMPUTE_API_KEY=xxxxx \
     --app <app-name>
   ```
   (Other config — RPC, chain id, compute base URL/model — uses the defaults in `src/config.ts`;
   override any of them with more `fly secrets set` / `[env]` entries if needed.)

## Deploy

```bash
fly deploy
```

## Keep it to ONE instance

Telegram allows only one long-polling client per bot token, so run **exactly one** machine:

```bash
fly scale count 1 --app <app-name>
```

Running two or more causes `getUpdates` 409 conflicts (the bot will flap).

## Operate

```bash
fly logs --app <app-name>      # tail logs; look for "[startup] ... bot @YourBot is running"
fly status --app <app-name>    # machine + volume state
fly secrets list --app <app-name>
```

## Uptime monitoring & cron

The app exposes a tiny health endpoint at **`https://<app-name>.fly.dev/health`** →
`{"status":"ok","uptime":N}` (served by `src/health.ts`, port 8080 via `[http_service]`).

- **UptimeRobot / Better Stack:** add an HTTP(s) monitor on `https://<app-name>.fly.dev/health`,
  interval 5 min, expecting `200`. You'll get alerted if the bot goes down.
- **cron-job.org (or any cron pinger):** add a job hitting the same URL on a schedule. This is
  optional — `auto_stop_machines = false` already keeps the machine running 24/7; the ping just
  feeds your uptime history and acts as a backup heartbeat.

The endpoint confirms the process is alive (not that Telegram polling is healthy), which is
enough for down/restart alerts.

## Notes

- `WALLET_ENCRYPTION_KEY` must stay **stable** — changing it makes existing stored wallets
  undecryptable. Set it once via `fly secrets` and leave it.
- The volume is tied to one machine/zone; that's expected for a single-instance bot.
- Fly restarts the machine if the process exits.
