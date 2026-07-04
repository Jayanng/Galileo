/**
 * Single source of truth for the bot's user-facing command references.
 *
 * Every command listed here appears in BOTH places automatically:
 *   1. The compact /help command list — handleHelp in src/handlers/walletHandlers.ts
 *   2. Section §2 of the deep FAQ — FAQ_TEXT in src/faq.ts (shown by the ❓ Help button)
 *
 * Why a single array? Before this file existed, /help and FAQ §2 carried two
 * slightly different lists of the same commands. Adding /foo meant editing
 * both, and the lists were already drifting in phrasing. With COMMANDS as the
 * one source of truth, both surfaces pick up the new row, the new phrasing,
 * the new example — without any second edit and no drift.
 *
 * Conventions:
 *   - `name` is the bare command (no leading slash).
 *   - `description` is the canonical short phrase. Identical text in both
 *     surfaces is the goal — pick whatever reads best in a thin list.
 *   - `example` is optional; if present, it shows up in parentheses after the
 *     description in both surfaces. Keep it short.
 *   - Order = display order in both /help and FAQ §2. Place related commands
 *     next to each other.
 */

export interface Command {
  /** /-prefixed command name typed by the user (no leading slash, but used with `/${name}` in outputs). */
  name: string;
  /** Short user-facing description — appears verbatim in both /help and FAQ §2. */
  description: string;
  /** Optional concrete example appended in parentheses. */
  example?: string;
}

export const COMMANDS: ReadonlyArray<Command> = [
  { name: 'start',    description: 'open your dashboard' },
  { name: 'wallet',   description: 'create a new wallet' },
  { name: 'import',   description: 'import an existing wallet by private key',
    example: 'no-arg = guided flow; /import <key> = inline preview' },
  { name: 'address',  description: 'pick a wallet and show its QR' },
  { name: 'balance',  description: 'OG balance for every wallet' },
  { name: 'privatekey', description: "reveal a wallet's key (one-tap hide)" },
  { name: 'send',     description: 'send OG to a recipient',
    example: '/send @tebasv2 0.1 or /send 0x… 0.1' },
  { name: 'wrap',     description: 'wrap OG → WOG', example: '/wrap 0.1' },
  { name: 'unwrap',   description: 'unwrap WOG → OG', example: '/unwrap 0.1' },
  { name: 'swap',     description: 'swap tokens, or open the Swap menu',
    example: '/swap 0.1 OG USDC' },
  { name: 'portfolio', description: 'USD value across all wallets + grand total' },
  { name: 'price',    description: 'USD price for a token', example: '/price OG' },
  { name: 'history',  description: 'portfolio P&L over time', example: '/history week' },
  { name: 'intents',  description: 'list DCA + alert schedules with Cancel/Pause buttons' },
  { name: 'cancel',   description: 'cancel an intent by id' },
  { name: 'pause',    description: 'pause or resume an intent by id' },
  { name: 'proof',    description: 'show your last 10 TEE-verified replies' },
  { name: 'help',     description: 'this guide' },
];

/**
 * Render a command as a single /help list line. Examples are wrapped in
 * backticks so they render as code spans in Markdown, matching the look of
 * renderFaqLines() — both surfaces format identically, which was the whole
 * point of centralising the data in COMMANDS.
 */
export function renderHelpLine(c: Command): string {
  const ex = c.example ? ` (e.g. \`${c.example}\`)` : '';
  return `/${c.name} — ${c.description}${ex}`;
}

/**
 * Compact /help text. Flat list, no sections, no dividers — meant to be
 * skimmable for power users / newcomers who want the command list directly.
 */
export const HELP_TEXT = [
  'Commands:',
  ...COMMANDS.map(renderHelpLine),
  '',
  'Tap the ❓ Help button on /start for the full guide.',
].join('\n');

/**
 * Render the same command set as Markdown bulleted lines, for use inside the
 * deep FAQ (§2). Use a backtick-formatted command name so it renders as
 * monospace in Telegram.
 */
export function renderFaqLines(): string[] {
  return COMMANDS.map((c) => {
    const ex = c.example ? ` — e.g. \`${c.example}\`` : '';
    return `• \`/${c.name}\` — ${c.description}${ex}`;
  });
}
