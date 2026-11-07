import 'dotenv/config';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  approveDraft,
  editDraftVariant,
  exportApprovedDraft,
  listDrafts,
  rejectDraft,
} from '../db/supabase.js';
import type { DraftRecord } from '../types.js';
import { renderReviewPage } from './render-page.js';

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createReviewHttpServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/') {
        const drafts = await listDrafts({ limit: 20 });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderReviewPage(drafts));
        return;
      }

      if (req.method === 'GET' && pathname === '/api/drafts') {
        const statusParam = url.searchParams.get('status') as DraftRecord['status'] | null;
        const drafts = await listDrafts({ status: statusParam ?? undefined, limit: 25 });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ drafts }, null, 2));
        return;
      }

      const editMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/variants\/([^/]+)\/edit$/);
      if (req.method === 'POST' && editMatch) {
        const raw = await readRequestBody(req);
        const isJson = (req.headers['content-type'] ?? '').includes('application/json');
        const payload = isJson
          ? (JSON.parse(raw) as Record<string, string | number>)
          : Object.fromEntries(new URLSearchParams(raw));

        const updated = await editDraftVariant({
          draftId: decodeURIComponent(editMatch[1]),
          variantId: decodeURIComponent(editMatch[2]),
          hook: String(payload.hook ?? ''),
          spoken: String(payload.spoken ?? ''),
          caption: String(payload.caption ?? ''),
          targetSeconds: Number(payload.targetSeconds ?? 20),
        });

        if (isJson) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        } else {
          res.writeHead(303, { Location: '/' });
          res.end();
        }
        return;
      }

      const approveMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/approve$/);
      if (req.method === 'POST' && approveMatch) {
        const raw = await readRequestBody(req);
        const isJson = (req.headers['content-type'] ?? '').includes('application/json');
        const payload = isJson
          ? (JSON.parse(raw) as Record<string, string>)
          : Object.fromEntries(new URLSearchParams(raw));

        const approved = await approveDraft({
          draftId: decodeURIComponent(approveMatch[1]),
          variantId: String(payload.variantId ?? ''),
        });

        if (isJson) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(approved));
        } else {
          res.writeHead(303, { Location: '/' });
          res.end();
        }
        return;
      }

      const killMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/kill$/);
      if (req.method === 'POST' && killMatch) {
        const raw = await readRequestBody(req);
        const isJson = (req.headers['content-type'] ?? '').includes('application/json');
        const payload = isJson
          ? (JSON.parse(raw) as Record<string, string>)
          : Object.fromEntries(new URLSearchParams(raw));

        const killed = await rejectDraft({
          draftId: decodeURIComponent(killMatch[1]),
          reason: payload.reason ? String(payload.reason) : undefined,
        });

        if (isJson) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(killed));
        } else {
          res.writeHead(303, { Location: '/' });
          res.end();
        }
        return;
      }

      const exportMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/export$/);
      if (req.method === 'GET' && exportMatch) {
        const { text } = await exportApprovedDraft({
          draftId: decodeURIComponent(exportMatch[1]),
          recordHistory: url.searchParams.get('record') === '1',
        });
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(text);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.REVIEW_PORT || 4321);
  const server = createReviewHttpServer();
  server.listen(port, () => {
    console.log(`BLAST review server listening at http://localhost:${port}`);
  });
}
