import { formatApprovedDraftExport } from '../db/supabase.js';
import type { DraftRecord, DraftStatus } from '../types.js';

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function formatStatusLabel(status: DraftStatus): string {
  switch (status) {
    case 'pending_review':
      return 'pending review';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'killed';
    case 'needs_rewrite':
      return 'needs rewrite';
  }
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function renderFilesSummary(draft: DraftRecord): string {
  const files = draft.event?.files ?? [];
  if (files.length === 0) return '';

  const preview = files.slice(0, 4).map((f) => `<code>${escapeHtml(f.path)}</code>`);
  const remaining = files.length - preview.length;
  if (remaining > 0) {
    preview.push(`<span class="files-more">+${remaining} more</span>`);
  }

  return `<div class="draft-files">${preview.join('<span class="sep">&middot;</span>')}</div>`;
}

function renderExportPanel(draft: DraftRecord): string {
  if (draft.status !== 'approved' || !draft.approved_variant_id) {
    return '';
  }

  let exportText: string;
  try {
    exportText = formatApprovedDraftExport(draft);
  } catch {
    return '';
  }

  const exportDomId = `export-${draft.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const exportHref = `/api/drafts/${encodeURIComponent(draft.id)}/export`;

  return `
    <section class="export-panel" aria-label="Approved plain-text export">
      <div class="export-bar">
        <span class="export-label">Approved export &middot; plain text</span>
        <div class="export-actions">
          <button type="button" class="btn btn-subtle" data-copy-target="${escapeHtml(exportDomId)}">Copy text</button>
          <a class="btn btn-subtle" href="${exportHref}" target="_blank" rel="noreferrer">Export raw text &nearr;</a>
        </div>
      </div>
      <pre id="${escapeHtml(exportDomId)}" class="export-pre">${escapeHtml(exportText)}</pre>
    </section>`;
}

function renderDraftCard(draft: DraftRecord): string {
  const title = draft.event?.title ?? draft.event_id;
  const repo = draft.event?.repo ?? null;
  const shortSha = draft.event?.sha ? draft.event.sha.slice(0, 7) : null;
  const fileCount = draft.event?.files?.length ?? 0;
  const sourceUrl = safeExternalUrl(draft.event?.url);
  const timestamp = formatTimestamp(draft.event?.timestamp ?? draft.created_at);

  const metaItems: string[] = [];
  if (repo) metaItems.push(`<span>${escapeHtml(repo)}</span>`);
  if (shortSha) {
    metaItems.push(`<code>${escapeHtml(shortSha)}</code>`);
  } else {
    metaItems.push(`<code>${escapeHtml(draft.event_id)}</code>`);
  }
  if (fileCount > 0) {
    metaItems.push(`<span>${fileCount} ${fileCount === 1 ? 'file' : 'files'}</span>`);
  }
  metaItems.push(`<span>${escapeHtml(draft.model_used)}</span>`);
  if (timestamp) {
    metaItems.push(`<span>${escapeHtml(timestamp)}</span>`);
  }

  const variantCards = draft.variants
    .map((v) => {
      const isApproved = draft.status === 'approved' && draft.approved_variant_id === v.id;
      const editAction = `/api/drafts/${encodeURIComponent(draft.id)}/variants/${encodeURIComponent(v.id)}/edit`;
      const approveAction = `/api/drafts/${encodeURIComponent(draft.id)}/approve`;

      return `
        <section class="variant-card${isApproved ? ' is-approved' : ''}">
          <div class="variant-head">
            <span class="variant-title">Variant ${v.variant_index}</span>
            <div class="variant-badges">
              <span class="meta-mono">${v.targetSeconds}s &middot; ${v.spoken_word_count}w</span>
              ${v.edited_by_human ? '<span class="pill pill-edited">edited</span>' : ''}
              ${isApproved ? '<span class="pill pill-approved">approved</span>' : ''}
            </div>
          </div>

          <div class="variant-body">
            <div class="field-block">
              <div class="field-label">Hook</div>
              <p class="hook-text">${escapeHtml(v.hook)}</p>
            </div>
            <div class="field-block">
              <div class="field-label">Spoken</div>
              <p class="spoken-text">${escapeHtml(v.spoken)}</p>
            </div>
            <div class="field-block field-caption">
              <div class="field-label">Caption</div>
              <p class="caption-text">${escapeHtml(v.caption)}</p>
            </div>
          </div>

          <div class="variant-actions">
            <details class="edit-disclosure">
              <summary class="btn btn-ghost edit-summary">Edit</summary>
              <form class="edit-form" method="POST" action="${editAction}">
                <label class="form-field">
                  <span class="form-label">Hook</span>
                  <input type="text" name="hook" value="${escapeHtml(v.hook)}" required />
                </label>
                <label class="form-field">
                  <span class="form-label">
                    <span>Spoken</span>
                    <span class="meta-mono" data-word-count>${v.spoken_word_count}w</span>
                  </span>
                  <textarea name="spoken" rows="5" data-spoken-input required>${escapeHtml(v.spoken)}</textarea>
                </label>
                <label class="form-field">
                  <span class="form-label">Caption</span>
                  <textarea name="caption" rows="3" required>${escapeHtml(v.caption)}</textarea>
                </label>
                <div class="edit-form-footer">
                  <label class="form-field form-field-inline">
                    <span class="form-label">Target (s)</span>
                    <input type="number" name="targetSeconds" min="5" max="120" value="${v.targetSeconds}" required />
                  </label>
                  <button type="submit" class="btn btn-secondary">Save Edit</button>
                </div>
              </form>
            </details>

            <form class="approve-form" method="POST" action="${approveAction}">
              <input type="hidden" name="variantId" value="${escapeHtml(v.id)}" />
              <button type="submit" class="btn ${isApproved ? 'btn-approved-current' : 'btn-approve'}">
                ${isApproved ? `Approved &middot; Variant ${v.variant_index}` : `Approve Variant ${v.variant_index}`}
              </button>
            </form>
          </div>
        </section>`;
    })
    .join('\n');

  const killNotice =
    draft.status === 'rejected' && draft.rejected_reason
      ? `<p class="killed-reason">Killed: ${escapeHtml(draft.rejected_reason)}</p>`
      : '';

  const killAction = `/api/drafts/${encodeURIComponent(draft.id)}/kill`;

  return `
    <article class="draft-card status-${escapeHtml(draft.status)}">
      <div class="draft-header">
        <div class="draft-header-main">
          <div class="draft-meta">
            <span class="status-badge status-badge-${escapeHtml(draft.status)}">
              <span class="dot"></span>${escapeHtml(formatStatusLabel(draft.status))}
            </span>
            ${metaItems.join('<span class="sep">&middot;</span>')}
          </div>
          <h2 class="draft-title">${escapeHtml(title)}</h2>
          ${renderFilesSummary(draft)}
          ${killNotice}
        </div>
        ${
          sourceUrl
            ? `<div class="draft-header-side"><a class="btn btn-subtle" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Source commit &nearr;</a></div>`
            : ''
        }
      </div>

      ${renderExportPanel(draft)}

      <div class="variants-grid">
        ${variantCards}
      </div>

      <footer class="draft-footer">
        <form class="kill-form" method="POST" action="${killAction}">
          <input type="text" name="reason" class="kill-input" placeholder="Optional kill reason&hellip;" />
          <button type="submit" class="btn btn-kill">Kill Draft Set</button>
        </form>
      </footer>
    </article>`;
}

const STYLES = `
:root {
  color-scheme: dark;
  --bg: #0d0f12;
  --surface: #151920;
  --surface-variant: #191e27;
  --surface-inset: #0f1217;
  --border: #262c36;
  --border-strong: #353d4b;
  --text: #e6e9ef;
  --text-muted: #a0a8b7;
  --text-dim: #6c7689;
  --approve: #238636;
  --approve-hover: #2ea043;
  --approve-border: rgba(46, 160, 67, 0.45);
  --approve-bg: rgba(46, 160, 67, 0.1);
  --pending: #d29922;
  --pending-bg: rgba(210, 153, 34, 0.12);
  --kill: #d9655f;
  --kill-bg: rgba(217, 101, 95, 0.12);
  --edited: #6ea8fe;
  --edited-bg: rgba(110, 168, 254, 0.12);
  --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

code, pre, .meta-mono {
  font-family: var(--mono);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(13, 15, 18, 0.92);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}

.topbar-inner {
  max-width: 1220px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand-group {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.brand {
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--text);
}

.subtitle {
  color: var(--text-dim);
  font-size: 13px;
}

.topbar-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-muted);
}

.counts {
  display: flex;
  align-items: center;
  gap: 12px;
}

.count-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-dim);
  display: inline-block;
}

.dot-pending, .status-badge-pending_review .dot {
  background: var(--pending);
}

.dot-approved, .status-badge-approved .dot {
  background: #3fb950;
}

.dot-killed, .status-badge-rejected .dot {
  background: var(--kill);
}

.gate-note {
  color: var(--text-dim);
  padding-left: 14px;
  border-left: 1px solid var(--border);
}

.container {
  max-width: 1220px;
  margin: 0 auto;
  padding: 24px 24px 72px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.empty-state {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 36px 24px;
  text-align: center;
  color: var(--text-muted);
}

.empty-state code {
  background: var(--surface-inset);
  border: 1px solid var(--border);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text);
}

.draft-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.draft-card.status-rejected {
  opacity: 0.72;
  transition: opacity 0.15s ease;
}

.draft-card.status-rejected:hover,
.draft-card.status-rejected:focus-within {
  opacity: 1;
}

.draft-header {
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.draft-header-main {
  min-width: 0;
  flex: 1;
}

.draft-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 6px;
}

.draft-meta code {
  color: var(--text-muted);
}

.sep {
  color: var(--border-strong);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 1px solid var(--border);
  color: var(--text-muted);
  background: var(--surface-inset);
}

.status-badge-pending_review {
  color: #e3b341;
  background: var(--pending-bg);
  border-color: rgba(210, 153, 34, 0.35);
}

.status-badge-approved {
  color: #56d364;
  background: var(--approve-bg);
  border-color: var(--approve-border);
}

.status-badge-rejected {
  color: var(--kill);
  background: var(--kill-bg);
  border-color: rgba(217, 101, 95, 0.3);
}

.draft-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text);
}

.draft-files {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}

.draft-files code {
  font-size: 11.5px;
  color: var(--text-muted);
  background: var(--surface-inset);
  border: 1px solid var(--border);
  padding: 1px 6px;
  border-radius: 4px;
}

.killed-reason {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--kill);
  font-family: var(--mono);
}

.export-panel {
  margin: 16px 20px 0;
  background: var(--surface-inset);
  border: 1px solid var(--approve-border);
  border-radius: 6px;
  overflow: hidden;
}

.export-bar {
  padding: 8px 12px;
  background: var(--approve-bg);
  border-bottom: 1px solid var(--approve-border);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.export-label {
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #56d364;
}

.export-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.export-pre {
  margin: 0;
  padding: 12px 14px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

.variants-grid {
  padding: 16px 20px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 14px;
  align-items: stretch;
}

.variant-card {
  background: var(--surface-variant);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.variant-card.is-approved {
  border-color: var(--approve-border);
  box-shadow: inset 0 0 0 1px rgba(46, 160, 67, 0.18);
}

.variant-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.variant-title {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.variant-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-dim);
}

.pill {
  font-family: var(--mono);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 4px;
}

.pill-edited {
  color: var(--edited);
  background: var(--edited-bg);
  border: 1px solid rgba(110, 168, 254, 0.3);
}

.pill-approved {
  color: #56d364;
  background: var(--approve-bg);
  border: 1px solid var(--approve-border);
}

.variant-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.field-caption {
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}

.field-label {
  font-family: var(--mono);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-dim);
}

.hook-text {
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text);
}

.spoken-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
}

.caption-text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-muted);
  white-space: pre-wrap;
}

.variant-actions {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  align-items: start;
}

.edit-disclosure[open] {
  grid-column: 1 / -1;
}

.edit-disclosure[open] + .approve-form {
  grid-column: 1 / -1;
}

.edit-summary {
  list-style: none;
  user-select: none;
}

.edit-summary::-webkit-details-marker {
  display: none;
}

.edit-disclosure[open] .edit-summary {
  margin-bottom: 10px;
  border-color: var(--border-strong);
  color: var(--text);
}

.edit-disclosure[open] .edit-summary::after {
  content: " (close)";
  color: var(--text-dim);
  font-weight: 400;
}

.edit-form {
  background: var(--surface-inset);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 4px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-field-inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.form-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
}

input[type="text"],
input[type="number"],
textarea {
  width: 100%;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 7px 9px;
  font-family: var(--sans);
  font-size: 13px;
  line-height: 1.45;
}

input[type="number"] {
  width: 72px;
  font-family: var(--mono);
}

textarea {
  resize: vertical;
}

input:focus,
textarea:focus {
  outline: none;
  border-color: var(--border-strong);
}

.edit-form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.approve-form {
  margin: 0;
}

.approve-form .btn {
  width: 100%;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface-inset);
  color: var(--text);
  font-family: var(--sans);
  font-size: 12.5px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.btn:hover {
  border-color: var(--border-strong);
  background: #1d232e;
}

.btn-ghost {
  background: transparent;
  color: var(--text-muted);
}

.btn-subtle {
  height: 28px;
  padding: 0 10px;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-muted);
}

.btn-secondary {
  background: #212733;
  border-color: var(--border-strong);
}

.btn-approve {
  background: var(--approve);
  border-color: rgba(240, 246, 252, 0.12);
  color: #ffffff;
  font-weight: 600;
}

.btn-approve:hover {
  background: var(--approve-hover);
  border-color: rgba(240, 246, 252, 0.22);
}

.btn-approved-current {
  background: var(--approve-bg);
  border-color: var(--approve-border);
  color: #56d364;
}

.btn-approved-current:hover {
  background: rgba(46, 160, 67, 0.18);
  border-color: var(--approve-border);
}

.draft-footer {
  padding: 10px 20px;
  background: rgba(10, 12, 16, 0.45);
  border-top: 1px solid var(--border);
}

.kill-form {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.kill-input {
  max-width: 280px;
  height: 30px;
  font-size: 12px;
  background: var(--surface-inset);
}

.btn-kill {
  height: 30px;
  background: transparent;
  border-color: var(--border);
  color: var(--text-dim);
  font-size: 12px;
}

.btn-kill:hover {
  background: var(--kill-bg);
  border-color: rgba(217, 101, 95, 0.4);
  color: var(--kill);
}

@media (max-width: 640px) {
  .topbar-inner,
  .container {
    padding-left: 14px;
    padding-right: 14px;
  }
  .gate-note {
    padding-left: 0;
    border-left: none;
  }
  .kill-form {
    justify-content: stretch;
  }
  .kill-input {
    max-width: none;
    flex: 1;
  }
}
`;

const CLIENT_SCRIPT = `
(() => {
  const savedScroll = sessionStorage.getItem('blast_review_scroll');
  if (savedScroll !== null) {
    sessionStorage.removeItem('blast_review_scroll');
    window.scrollTo(0, Number(savedScroll) || 0);
  }

  document.addEventListener('submit', () => {
    sessionStorage.setItem('blast_review_scroll', String(window.scrollY));
  });

  document.querySelectorAll('[data-spoken-input]').forEach((el) => {
    const label = el.closest('.form-field')?.querySelector('[data-word-count]');
    if (!label) return;
    el.addEventListener('input', () => {
      const words = el.value.trim() ? el.value.trim().split(/\\s+/).length : 0;
      label.textContent = words + 'w';
    });
  });

  document.querySelectorAll('[data-copy-target]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-copy-target');
      const pre = id ? document.getElementById(id) : null;
      if (!pre || !navigator.clipboard) return;
      const original = btn.textContent;
      await navigator.clipboard.writeText(pre.textContent || '');
      btn.textContent = 'Copied';
      setTimeout(() => {
        btn.textContent = original;
      }, 1400);
    });
  });
})();
`;

export function renderReviewPage(drafts: DraftRecord[]): string {
  const pendingCount = drafts.filter((d) => d.status === 'pending_review').length;
  const approvedCount = drafts.filter((d) => d.status === 'approved').length;
  const killedCount = drafts.filter((d) => d.status === 'rejected').length;
  const rewriteCount = drafts.filter((d) => d.status === 'needs_rewrite').length;

  const content =
    drafts.length === 0
      ? `<div class="empty-state">No drafts in Supabase yet. Run <code>npm run sync</code> to ingest a commit.</div>`
      : drafts.map(renderDraftCard).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BLAST &middot; Review Queue</title>
  <style>${STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand-group">
        <span class="brand">BLAST</span>
        <span class="sep">/</span>
        <span class="subtitle">review queue</span>
      </div>
      <div class="topbar-meta">
        <div class="counts">
          <span class="count-item"><span class="dot dot-pending"></span>${pendingCount} pending</span>
          <span class="count-item"><span class="dot dot-approved"></span>${approvedCount} approved</span>
          <span class="count-item"><span class="dot dot-killed"></span>${killedCount} killed</span>
          ${rewriteCount > 0 ? `<span class="count-item"><span class="dot"></span>${rewriteCount} rewrite</span>` : ''}
        </div>
        <span class="gate-note">Manual gate &middot; nothing posts automatically</span>
      </div>
    </div>
  </header>

  <main class="container">
    ${content}
  </main>

  <script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
