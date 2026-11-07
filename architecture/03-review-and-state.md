# SOP 03 — Human Review Gate, Supabase State & MCP Surface

## Objective
Maintain all progress events, drafts, human edits, approvals, rejections ("kills"), voice rules, and posted history in Supabase (`rpqasmcvwkajtbhzufii`), exposed through both BLAST's MCP server (`src/mcp/server.ts`) and a minimal local review server (`src/review/server.ts`).

## Absolute Safety Rule
**Nothing posts automatically.** There is no TikTok/Buffer/social upload API in Layer 2 or Layer 3. `approve_draft` only transitions database state to `approved` for a human-selected variant and unlocks plain-text export (`export_draft`).

## State Machine (`public.drafts.status`)
- `pending_review` — Initial state after `generate-variants.ts` passes `validate-voice.ts`.
- `approved` — Human explicitly selects one `variant_id` (`approved_variant_id` set, `approved_at = now()`).
- `rejected` — Human kills the draft set (`rejected_reason` optional).
- `needs_rewrite` — Human flags the draft set for regeneration.

Inline human edits (`edit_draft_variant`) update `hook`, `spoken`, `caption`, `target_seconds`, `spoken_word_count`, and set `edited_by_human = true` on `public.draft_variants` prior to (or alongside) approval.

## Navigation Surfaces (Layer 2)
### 1. MCP Server (`src/mcp/server.ts`)
Exposes the blueprint's 8 tools plus `edit_draft_variant`:
- `list_progress_events` — Filter by `source`, `repo`, `filter_action`, `limit`
- `get_progress_event` — Single event by `id`
- `draft_scripts` — Generate 2–3 variants for a kept `event_id` and store as `pending_review`
- `list_drafts` — Filter by `status` (`pending_review`, `approved`, `rejected`, `needs_rewrite`)
- `get_draft` — Draft + ordered `variants[]` + source `progress_event`
- `edit_draft_variant` — Update `hook`, `spoken`, `caption`, `targetSeconds` on a variant
- `approve_draft` — Set `status = 'approved'` and `approved_variant_id` (never posts)
- `reject_draft` — Set `status = 'rejected'` ("kill")
- `export_draft` — Require `status === 'approved'`; return plain-text hook + spoken + caption and optionally log export in `public.posted_history`

### 2. Local Skeleton Review Queue (`src/review/server.ts`)
Unstyled functional skeleton HTTP server (`http://localhost:4321`) for the Links + Architecture phase:
- `GET /` — Minimal HTML list of `pending_review` (and recent `approved`/`rejected`) drafts with inline forms for **Edit**, **Approve**, **Kill**, and **Export**.
- `GET /api/drafts` — JSON list of drafts + variants.
- `POST /api/drafts/:id/variants/:variantId/edit` — Save human edits.
- `POST /api/drafts/:id/approve` — Approve chosen variant.
- `POST /api/drafts/:id/kill` — Reject draft set.
- `GET /api/drafts/:id/export` — Return plain text for an approved draft.
