import { createServer, type Server } from 'node:http';

/**
 * Minimal HTTP health endpoint.
 *
 * The bot is a long-polling worker with no inbound traffic, so this is the only
 * public surface. It exists purely so external uptime monitors (UptimeRobot,
 * Better Stack) and cron pingers (cron-job.org) have a URL to hit.
 *
 *   GET /health  (or /)  -> 200 { status: "ok", uptime }
 *   anything else        -> 404
 */
export function startHealthServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()) }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  server.listen(port, () => console.log(`[health] listening on :${port}`));
  return server;
}
