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
      return 'Pending review';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Killed';
    case 'needs_rewrite':
      return 'Needs rewrite';
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

  const preview = files.slice(0, 4).map((f) => `<code class="file-chip">${escapeHtml(f.path)}</code>`);
  const remaining = files.length - preview.length;
  if (remaining > 0) {
    preview.push(`<span class="files-more">+${remaining} more</span>`);
  }

  return `<div class="draft-files">${preview.join('')}</div>`;
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
        <span class="export-label">
          <span class="dot dot-approved"></span>
          Approved export &middot; plain text
        </span>
        <div class="export-actions">
          <button type="button" class="btn btn-pill-subtle" data-copy-target="${escapeHtml(exportDomId)}">Copy text</button>
          <a class="btn btn-pill-subtle" href="${exportHref}" target="_blank" rel="noreferrer">Export raw text &nearr;</a>
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
  if (repo) metaItems.push(`<span class="meta-item">${escapeHtml(repo)}</span>`);
  if (shortSha) {
    metaItems.push(`<code class="meta-sha">${escapeHtml(shortSha)}</code>`);
  } else {
    metaItems.push(`<code class="meta-sha">${escapeHtml(draft.event_id)}</code>`);
  }
  if (fileCount > 0) {
    metaItems.push(`<span class="meta-item">${fileCount} ${fileCount === 1 ? 'file' : 'files'}</span>`);
  }
  metaItems.push(`<span class="meta-item">${escapeHtml(draft.model_used)}</span>`);
  if (timestamp) {
    metaItems.push(`<span class="meta-mono meta-time">${escapeHtml(timestamp)}</span>`);
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
              <span class="metric-pill meta-mono">${v.targetSeconds}s &middot; ${v.spoken_word_count}w</span>
              ${v.edited_by_human ? '<span class="pill"><span class="dot dot-edited"></span>Edited</span>' : ''}
              ${isApproved ? '<span class="pill pill-approved"><span class="dot dot-approved"></span>Approved</span>' : ''}
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
              <summary class="btn btn-edit edit-summary">Edit</summary>
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
                  <button type="submit" class="btn btn-save">Save Edit</button>
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
      ? `<p class="killed-reason"><span class="dot dot-killed"></span>Killed: ${escapeHtml(draft.rejected_reason)}</p>`
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
            ${metaItems.join('<span class="sep" aria-hidden="true">&middot;</span>')}
          </div>
          <h2 class="draft-title">${escapeHtml(title)}</h2>
          ${renderFilesSummary(draft)}
          ${killNotice}
        </div>
        ${
          sourceUrl
            ? `<div class="draft-header-side"><a class="btn btn-pill-subtle" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Source commit &nearr;</a></div>`
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
  --bg: #08090b;
  --surface: #101216;
  --surface-elevated: #16191f;
  --surface-elevated-bottom: #12151a;
  --surface-inset: #0b0c0f;
  --pill-bg: rgba(255, 255, 255, 0.05);
  --pill-border: rgba(255, 255, 255, 0.065);
  --hairline: rgba(255, 255, 255, 0.055);
  --hairline-strong: rgba(255, 255, 255, 0.11);
  --top-shine: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  --text: #f3f4f7;
  --text-body: #c9ced8;
  --text-muted: #8b919f;
  --text-dim: #666c7a;
  --dot-pending: #df9f45;
  --dot-approved: #48c385;
  --dot-killed: #df6f68;
  --dot-edited: #6ea3f5;
  --sans: "Inter", "Segoe UI Variable Text", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --display: "Inter", "Segoe UI Variable Display", "Segoe UI Variable Text", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", "Cascadia Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

*, *::before, *::after {
  box-sizing: border-box;
}

html {
  background: var(--bg);
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(1100px 480px at 50% -180px, rgba(255, 255, 255, 0.028), transparent 70%),
    var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

code, pre, .meta-mono, .meta-sha {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}

.topbar {
  border-bottom: 1px solid var(--hairline);
  background: rgba(8, 9, 11, 0.84);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  position: sticky;
  top: 0;
  z-index: 20;
}

.topbar-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 16px 32px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.brand-group {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-mark-wrap {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.brand-emblem {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: linear-gradient(145deg, #221f1a 0%, #131210 100%);
  border: 1px solid rgba(223, 159, 69, 0.24);
  box-shadow: inset 0 1px 0 rgba(255, 224, 178, 0.12);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.brand-emblem::after {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: linear-gradient(135deg, #e5b162 0%, #b88238 100%);
}

.brand {
  font-family: var(--display);
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--text);
}

.topbar-divider {
  width: 1px;
  height: 14px;
  background: rgba(255, 255, 255, 0.1);
}

.topbar-subtitle {
  font-size: 13px;
  font-weight: 450;
  color: var(--text-muted);
}

.gate-note {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 7px 14px;
  border-radius: 999px;
  background: #111318;
  border: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow: var(--top-shine);
  font-size: 12.5px;
  font-weight: 450;
  color: #b4bac7;
}

.gate-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dot-pending);
  flex-shrink: 0;
}

.container {
  max-width: 1240px;
  margin: 0 auto;
  padding: 40px 32px 96px;
  display: flex;
  flex-direction: column;
  gap: 36px;
}

.overview-section {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.overview-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.overview-eyebrow {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 400;
  color: var(--text-muted);
  letter-spacing: -0.005em;
}

.overview-title {
  margin: 0;
  font-family: var(--display);
  font-size: 32px;
  font-weight: 550;
  letter-spacing: -0.024em;
  line-height: 1.15;
  color: var(--text);
}

.overview-total {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--text-muted);
  font-size: 13.5px;
}

.overview-total-num {
  font-family: var(--display);
  font-size: 28px;
  font-weight: 550;
  letter-spacing: -0.025em;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.overview-strip {
  padding-top: 20px;
  border-top: 1px solid var(--hairline);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.overview-strip-label {
  font-size: 13px;
  color: var(--text-muted);
}

.counts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.count-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 13px;
  border-radius: 999px;
  background: var(--pill-bg);
  border: 1px solid var(--pill-border);
  font-size: 12.5px;
  font-weight: 500;
  color: #d2d6e0;
  font-variant-numeric: tabular-nums;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-dim);
  display: inline-block;
  flex-shrink: 0;
}

.dot-pending, .status-badge-pending_review .dot {
  background: var(--dot-pending);
}

.dot-approved, .status-badge-approved .dot {
  background: var(--dot-approved);
}

.dot-killed, .status-badge-rejected .dot {
  background: var(--dot-killed);
}

.dot-edited {
  background: var(--dot-edited);
}

.empty-state {
  background: var(--surface);
  border: 1px solid var(--hairline);
  box-shadow: var(--top-shine), 0 24px 48px -24px rgba(0, 0, 0, 0.75);
  border-radius: 26px;
  padding: 56px 32px;
  text-align: center;
  color: var(--text-muted);
  font-size: 14.5px;
}

.empty-state code {
  background: rgba(255, 255, 255, 0.055);
  padding: 3px 9px;
  border-radius: 999px;
  color: var(--text);
  font-size: 13px;
}

.draft-list {
  display: flex;
  flex-direction: column;
  gap: 36px;
}

.draft-card {
  background: var(--surface);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 28px;
  box-shadow: var(--top-shine), 0 26px 56px -28px rgba(0, 0, 0, 0.82);
  overflow: hidden;
}

.draft-card.status-rejected {
  opacity: 0.68;
  transition: opacity 0.2s ease;
}

.draft-card.status-rejected:hover,
.draft-card.status-rejected:focus-within {
  opacity: 1;
}

.draft-header {
  padding: 28px 30px 24px;
  border-bottom: 1px solid var(--hairline);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.draft-header-main {
  min-width: 0;
  flex: 1;
}

.draft-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
  font-size: 12.5px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.meta-sha {
  font-size: 12px;
  color: #b7bdca;
}

.meta-time {
  font-size: 11.5px;
  color: var(--text-dim);
}

.sep {
  color: rgba(255, 255, 255, 0.18);
  user-select: none;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.005em;
  background: var(--pill-bg);
  border: 1px solid var(--pill-border);
  color: #d8dce5;
}

.draft-title {
  margin: 0;
  font-family: var(--display);
  font-size: 22px;
  font-weight: 540;
  letter-spacing: -0.018em;
  line-height: 1.32;
  color: var(--text);
}

.draft-files {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.file-chip {
  font-size: 11.5px;
  color: #9ea4b3;
  background: rgba(255, 255, 255, 0.038);
  padding: 3px 10px;
  border-radius: 999px;
}

.files-more {
  font-size: 12px;
  color: var(--text-dim);
  padding-left: 4px;
}

.killed-reason {
  margin: 12px 0 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(223, 111, 104, 0.08);
  border: 1px solid rgba(223, 111, 104, 0.2);
  font-size: 12px;
  color: #e59893;
}

.export-panel {
  margin: 24px 30px 0;
  background: var(--surface-inset);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 20px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
  overflow: hidden;
}

.export-bar {
  padding: 12px 18px;
  background: rgba(255, 255, 255, 0.018);
  border-bottom: 1px solid var(--hairline);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.export-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 500;
  color: #cfd4df;
}

.export-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.export-pre {
  margin: 0;
  padding: 18px 20px;
  font-size: 12.5px;
  line-height: 1.65;
  color: #c8cdd8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.variants-grid {
  padding: 24px 30px 26px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 18px;
  align-items: stretch;
}

.variants-grid:has(.edit-disclosure[open]) {
  align-items: start;
}

.variant-card {
  min-width: 0;
  background: linear-gradient(180deg, #181b22 0%, #13151b 100%);
  border: 1px solid rgba(255, 255, 255, 0.062);
  border-radius: 22px;
  padding: 22px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.055), 0 14px 30px -18px rgba(0, 0, 0, 0.72);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.variant-card.is-approved {
  background:
    radial-gradient(90% 55% at 50% 0%, rgba(72, 195, 133, 0.075), transparent 72%),
    linear-gradient(180deg, #191d24 0%, #13161c 100%);
  border-color: rgba(255, 255, 255, 0.095);
  box-shadow: inset 0 1px 0 rgba(144, 232, 186, 0.16), 0 16px 34px -18px rgba(0, 0, 0, 0.78);
}

.variant-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.048);
}

.variant-title {
  font-size: 15.5px;
  font-weight: 500;
  letter-spacing: -0.015em;
  color: var(--text);
}

.variant-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.metric-pill {
  font-size: 11.5px;
  color: #9ba1b0;
  background: rgba(255, 255, 255, 0.042);
  border: 1px solid rgba(255, 255, 255, 0.055);
  padding: 3px 10px;
  border-radius: 999px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 500;
  color: #d4d8e2;
  background: var(--pill-bg);
  border: 1px solid var(--pill-border);
  padding: 3px 10px;
  border-radius: 999px;
}

.pill-approved {
  background: rgba(72, 195, 133, 0.09);
  border-color: rgba(72, 195, 133, 0.22);
  color: #cbeed9;
}

.variant-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-caption {
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.045);
}

.field-label {
  font-size: 11.5px;
  font-weight: 450;
  color: var(--text-dim);
  letter-spacing: 0.01em;
}

.hook-text {
  margin: 0;
  font-size: 15.5px;
  font-weight: 540;
  line-height: 1.44;
  letter-spacing: -0.008em;
  color: var(--text);
}

.spoken-text {
  margin: 0;
  font-size: 13.75px;
  line-height: 1.68;
  color: var(--text-body);
  white-space: pre-wrap;
}

.caption-text {
  margin: 0;
  font-size: 12.75px;
  line-height: 1.56;
  color: var(--text-muted);
  white-space: pre-wrap;
}

.variant-actions {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.048);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
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
  margin-bottom: 12px;
  background: rgba(255, 255, 255, 0.09);
  border-color: var(--hairline-strong);
  color: var(--text);
}

.edit-disclosure[open] .edit-summary::after {
  content: " · Close";
  color: var(--text-muted);
  font-weight: 400;
}

.edit-form {
  background: var(--surface-inset);
  border: 1px solid rgba(255, 255, 255, 0.065);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 4px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field-inline {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.form-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 450;
  color: var(--text-muted);
}

input[type="text"],
input[type="number"],
textarea {
  width: 100%;
  appearance: none;
  background: #13161c;
  color: var(--text);
  border: 1px solid rgba(255, 255, 255, 0.075);
  border-radius: 12px;
  padding: 9px 12px;
  font-family: var(--sans);
  font-size: 13.5px;
  line-height: 1.5;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

input[type="number"] {
  width: 78px;
  font-family: var(--mono);
  text-align: center;
}

textarea {
  resize: vertical;
}

input:focus,
textarea:focus {
  outline: none;
  background: #161a21;
  border-color: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.04);
}

.edit-form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
}

.approve-form {
  margin: 0;
}

.approve-form .btn {
  width: 100%;
}

.btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 38px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #1a1d24;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color: var(--text);
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.005em;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
}

.btn:hover {
  background: #222630;
  border-color: rgba(255, 255, 255, 0.14);
}

.btn:active {
  transform: translateY(0.5px);
}

.btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.12);
}

.btn-pill-subtle {
  height: 32px;
  padding: 0 14px;
  font-size: 12px;
  font-weight: 500;
  background: #171a20;
  border-color: rgba(255, 255, 255, 0.075);
  color: #cfd4df;
}

.btn-pill-subtle:hover {
  background: #20242d;
  color: var(--text);
}

.btn-edit {
  padding: 0 16px;
  background: rgba(255, 255, 255, 0.042);
  border-color: rgba(255, 255, 255, 0.075);
  color: #c7ccd7;
}

.btn-edit:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.13);
  color: var(--text);
}

.btn-save {
  height: 36px;
  padding: 0 18px;
  background: linear-gradient(180deg, #3c4352 0%, #282d38 100%);
  border-color: rgba(255, 255, 255, 0.16);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 6px 14px -4px rgba(0, 0, 0, 0.5);
  color: #f6f7fa;
  font-weight: 550;
}

.btn-save:hover {
  background: linear-gradient(180deg, #464e5f 0%, #303643 100%);
  border-color: rgba(255, 255, 255, 0.24);
  color: #ffffff;
}

.btn-approve {
  background: linear-gradient(180deg, #383f4d 0%, #252a34 100%);
  border-color: rgba(255, 255, 255, 0.14);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 8px 18px -6px rgba(0, 0, 0, 0.55);
  color: #f5f7fa;
  font-weight: 550;
}

.btn-approve:hover {
  background: linear-gradient(180deg, #434b5c 0%, #2d3340 100%);
  border-color: rgba(255, 255, 255, 0.22);
  color: #ffffff;
}

.draft-card.status-approved .btn-approve {
  background: linear-gradient(180deg, #252933 0%, #1a1d24 100%);
  border-color: rgba(255, 255, 255, 0.085);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.09), 0 4px 12px rgba(0, 0, 0, 0.35);
  color: #d4d9e3;
  font-weight: 500;
}

.draft-card.status-approved .btn-approve:hover {
  background: linear-gradient(180deg, #2f3542 0%, #21252f 100%);
  border-color: rgba(255, 255, 255, 0.15);
  color: #f5f7fa;
}

.btn-approved-current {
  background: linear-gradient(180deg, rgba(72, 195, 133, 0.18) 0%, rgba(72, 195, 133, 0.09) 100%);
  border-color: rgba(72, 195, 133, 0.32);
  box-shadow: inset 0 1px 0 rgba(154, 236, 194, 0.16);
  color: #a9ecc7;
  font-weight: 500;
}

.btn-approved-current:hover {
  background: linear-gradient(180deg, rgba(72, 195, 133, 0.24) 0%, rgba(72, 195, 133, 0.13) 100%);
  border-color: rgba(72, 195, 133, 0.42);
  color: #c3f3d8;
}

.draft-footer {
  padding: 16px 30px 22px;
  border-top: 1px solid rgba(255, 255, 255, 0.045);
  background: rgba(8, 9, 11, 0.28);
}

.kill-form {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

input[type="text"].kill-input {
  max-width: 280px;
  height: 36px;
  padding: 0 15px;
  border-radius: 999px;
  font-size: 12.5px;
  background: var(--surface-inset);
  border-color: rgba(255, 255, 255, 0.065);
}

input[type="text"].kill-input::placeholder {
  color: var(--text-dim);
}

.btn-kill {
  height: 36px;
  padding: 0 16px;
  background: rgba(255, 255, 255, 0.038);
  border-color: rgba(255, 255, 255, 0.075);
  color: var(--text-muted);
  font-size: 12.5px;
}

.btn-kill:hover {
  background: rgba(223, 111, 104, 0.13);
  border-color: rgba(223, 111, 104, 0.32);
  color: #ef958f;
}

@media (max-width: 720px) {
  .topbar-inner,
  .container {
    padding-left: 18px;
    padding-right: 18px;
  }
  .container {
    padding-top: 28px;
    gap: 28px;
  }
  .gate-note {
    font-size: 11.5px;
    padding: 6px 11px;
  }
  .topbar-divider,
  .topbar-subtitle {
    display: none;
  }
  .overview-title {
    font-size: 25px;
  }
  .draft-header,
  .variants-grid,
  .draft-footer {
    padding-left: 20px;
    padding-right: 20px;
  }
  .export-panel {
    margin-left: 20px;
    margin-right: 20px;
  }
  .kill-form {
    justify-content: stretch;
  }
  input[type="text"].kill-input {
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
      : `<div class="draft-list">${drafts.map(renderDraftCard).join('\n')}</div>`;

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
        <span class="brand-mark-wrap">
          <span class="brand-emblem" aria-hidden="true"></span>
          <span class="brand">BLAST</span>
        </span>
        <span class="topbar-divider" aria-hidden="true"></span>
        <span class="topbar-subtitle">Review Queue</span>
      </div>
      <div class="gate-note">
        <span class="gate-dot" aria-hidden="true"></span>
        <span>Manual gate &middot; nothing posts automatically</span>
      </div>
    </div>
  </header>

  <main class="container">
    <section class="overview-section" aria-label="Queue summary">
      <div class="overview-hero">
        <div>
          <p class="overview-eyebrow">Local approval gate</p>
          <h1 class="overview-title">Review Queue</h1>
        </div>
        <div class="overview-total">
          <span class="overview-total-num">${drafts.length}</span>
          <span>${drafts.length === 1 ? 'draft set' : 'draft sets'}</span>
        </div>
      </div>
      <div class="overview-strip">
        <span class="overview-strip-label">Queue status</span>
        <div class="counts">
          <span class="count-item"><span class="dot dot-pending"></span>${pendingCount} pending</span>
          <span class="count-item"><span class="dot dot-approved"></span>${approvedCount} approved</span>
          <span class="count-item"><span class="dot dot-killed"></span>${killedCount} killed</span>
          ${rewriteCount > 0 ? `<span class="count-item"><span class="dot"></span>${rewriteCount} rewrite</span>` : ''}
        </div>
      </div>
    </section>

    ${content}
  </main>

  <script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
