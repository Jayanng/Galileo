import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal HTTP health endpoint.
 *
 * The bot is a long-polling worker with no inbound traffic, so this is the only
 * public surface. It exists purely so external uptime monitors (UptimeRobot,
 * Better Stack) and cron pingers (cron-job.org) have a URL to hit.
 *
 *   GET /health  (or /)  -> 200 { status: "ok", uptime }
 *   GET /proofs          -> public/proofs.json
 *   anything else        -> 404
 */

// Resolve path to proofs.json relative to this file
let _proofsPath: string;
try {
  _proofsPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'proofs.json');
} catch {
  _proofsPath = resolve(process.cwd(), 'public', 'proofs.json');
}

export function startHealthServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()) }));
      return;
    }

    if (req.method === 'GET' && req.url === '/proofs') {
      try {
        if (existsSync(_proofsPath)) {
          const data = readFileSync(_proofsPath, 'utf8');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(data);
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ generatedAt: new Date().toISOString(), userCount: 0, totalProofs: 0, entries: [] }));
        }
      } catch {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to read proofs index' }));
      }
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  server.listen(port, () => console.log(`[health] listening on :${port}`));
  return server;
}
