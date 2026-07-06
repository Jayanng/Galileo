import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proofsPage, verifyPage, statusPage, intentsLivePage, nftMetadataPage } from './proofCenter';

/**
 * HTTP server for health checks and the public Proof Center.
 *
 *   GET /health                    -> 200 { status: "ok", uptime }
 *   GET /                          -> 200 { status: "ok", uptime }
 *   GET /proofs                    -> Proof Center live feed (HTML)
 *   GET /verify/:rootHash          -> Receipt verification from 0G Storage
 *   GET /status                    -> Health dashboard (compute, storage, chain)
 *   GET /intents/live               -> DCA & alert executions with proof links
 *   GET /nft-metadata/:key          -> NFT metadata JSON from 0G Storage (for explorers)
 *   anything else                  -> 404
 */

let _proofsPath: string;
try {
  _proofsPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'proofs.json');
} catch {
  _proofsPath = resolve(process.cwd(), 'public', 'proofs.json');
}

export function startHealthServer(port: number): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';

    if (req.method === 'GET' && (url === '/health' || url === '/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()) }));
      return;
    }

    if (req.method === 'GET' && url === '/proofs') {
      void proofsPage(req, res);
      return;
    }

    if (req.method === 'GET' && url.startsWith('/verify/')) {
      const root = url.slice('/verify/'.length).trim() || undefined;
      void verifyPage(req, res, root);
      return;
    }

    if (req.method === 'GET' && url === '/status') {
      void statusPage(req, res);
      return;
    }

    if (req.method === 'GET' && url === '/intents/live') {
      void intentsLivePage(req, res);
      return;
    }

    // NFT metadata proxy — serves JSON metadata from 0G Storage so explorers
    // (ChainScan, block explorers, etc.) can resolve the tokenURI via HTTP.
    if (req.method === 'GET' && url.startsWith('/nft-metadata/')) {
      const key = url.slice('/nft-metadata/'.length).trim();
      void nftMetadataPage(req, res, key);
      return;
    }

    // Legacy JSON proofs endpoint (backward compat)
    if (req.method === 'GET' && url === '/proofs.json') {
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
