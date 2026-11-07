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

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function renderSkeletonPage(drafts: DraftRecord[]): string {
  const sections =
    drafts.length === 0
      ? '<p>No drafts in Supabase yet. Run <code>npm run sync</code> to ingest a commit.</p>'
      : drafts
          .map((d) => {
            const variantBlocks = d.variants
              .map(
                (v) => `
              <fieldset>
                <legend>
                  Variant ${v.variant_index} (${v.targetSeconds}s, ${v.spoken_word_count} words)
                  ${d.approved_variant_id === v.id ? '[APPROVED]' : ''}
                  ${v.edited_by_human ? '[EDITED]' : ''}
                </legend>
                <form method="POST" action="/api/drafts/${encodeURIComponent(d.id)}/variants/${encodeURIComponent(v.id)}/edit">
                  <p>
                    <label>Hook:<br>
                      <input type="text" name="hook" value="${escapeHtml(v.hook)}" size="80" />
                    </label>
                  </p>
                  <p>
                    <label>Spoken:<br>
                      <textarea name="spoken" rows="4" cols="80">${escapeHtml(v.spoken)}</textarea>
                    </label>
                  </p>
                  <p>
                    <label>Caption:<br>
                      <textarea name="caption" rows="3" cols="80">${escapeHtml(v.caption)}</textarea>
                    </label>
                  </p>
                  <p>
                    <label>Target Seconds:
                      <input type="number" name="targetSeconds" min="15" max="25" value="${v.targetSeconds}" />
                    </label>
                    <button type="submit">Save Edit</button>
                  </p>
                </form>
                <form method="POST" action="/api/drafts/${encodeURIComponent(d.id)}/approve">
                  <input type="hidden" name="variantId" value="${escapeHtml(v.id)}" />
                  <button type="submit">Approve Variant ${v.variant_index}</button>
                </form>
              </fieldset>`
              )
              .join('\n');

            const exportLink =
              d.status === 'approved'
                ? `<p><a href="/api/drafts/${encodeURIComponent(d.id)}/export">Export Approved Plain Text</a></p>`
                : '';

            return `
            <article>
              <hr />
              <h2>${escapeHtml(d.event?.title ?? d.event_id)}</h2>
              <p>
                Status: <strong>${escapeHtml(d.status)}</strong> |
                Event: <code>${escapeHtml(d.event_id)}</code> |
                Model: <code>${escapeHtml(d.model_used)}</code>
                ${d.event?.url ? `| <a href="${escapeHtml(d.event.url)}" target="_blank" rel="noreferrer">Source Commit</a>` : ''}
              </p>
              ${exportLink}
              ${variantBlocks}
              <form method="POST" action="/api/drafts/${encodeURIComponent(d.id)}/kill">
                <input type="text" name="reason" placeholder="Optional kill reason" size="40" />
                <button type="submit">Kill Draft Set</button>
              </form>
            </article>`;
          })
          .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>BLAST Review Queue (Skeleton)</title>
</head>
<body>
  <h1>BLAST Pending &amp; Recent Drafts (Unstyled Skeleton)</h1>
  <p>Human approval gate active: nothing posts automatically.</p>
  ${sections}
</body>
</html>`;
}

export function createReviewHttpServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/') {
        const drafts = await listDrafts({ limit: 20 });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderSkeletonPage(drafts));
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
    console.log(`BLAST skeleton review server listening at http://localhost:${port}`);
  });
}
