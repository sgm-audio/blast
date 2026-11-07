# BLAST blueprint

This is the current architecture for BLAST, the Building-in-Public Auto-Poster. It describes what the tool is supposed to do. The repo itself is the first commit of that plan; the ingest, generator, and MCP server are not built yet.

Last updated: 2026-11-07 (America/Regina).

## Purpose

BLAST turns a real project change into a short TikTok draft: a hook, a spoken script, and a caption.

It exists for two uses at once:

- I point it at this repo (and later its Vercel deploys) and use the drafts for my own building-in-public posts.
- Someone else points it at their GitHub and Vercel accounts and gets the same kind of drafts. The product surface is an MCP, not a pile of one-off prompts.

It does not invent progress. If nothing shipped, it produces nothing.

It does not post on its own. Approval is a required step.

## Sources

### GitHub (connected)

Watched on this project first: `sgm-audio/blast`.

Events:

- Commits on the default branch
- Pull requests that merge or that are opened with a real description of a change
- Releases, later, if we start tagging

A commit or pull request becomes a progress event with its subject, body, changed files, URL, and timestamp.

### Vercel (not connected yet)

Once connected, production and preview deploys become progress events with the deployment URL, environment, git SHA if present, and timestamp.

Until that connection exists, deploy-based drafts are out of scope. Do not fake a deploy event.

### Out of scope for v1

- Other people's repos unless they connect their own accounts
- Analytics, follower counts, or "what will perform" scoring
- Auto-posting to TikTok or anywhere else
- Rewriting history or generating a video from footage

## Progress event

Every source normalizes to the same shape. The JSON Schema is in [progress-event.schema.json](progress-event.schema.json).

```json
{
  "id": "github:sgm-audio/blast:commit:abc1234",
  "source": "github",
  "kind": "commit",
  "repo": "sgm-audio/blast",
  "sha": "abc1234",
  "ref": "main",
  "title": "Add progress event schema and voice rules",
  "body": "",
  "files": [
    {"path": "docs/voice.md", "status": "added", "additions": 80, "deletions": 0}
  ],
  "url": "https://github.com/sgm-audio/blast/commit/abc1234",
  "deployUrl": null,
  "environment": null,
  "timestamp": "2026-11-07T00:00:00-06:00"
}
```

`id` is stable for a given source event so the same commit does not generate a second draft pile if ingest runs twice.

## Filter

Drop an event, and write down why, when:

- The only files touched are lockfiles, `package-lock.json`, `pnpm-lock.yaml`, generated build output, or formatting-only changes
- The commit subject starts with `chore:` and the file list is only tooling config
- The commit message contains `[skip content]`
- The pull request is empty or only rebases another branch
- A preview deploy has no URL and no associated SHA we can describe

Keep an event when at least one user-visible file changed, or a deploy landed at a real URL, or the commit message describes a user-visible change that the file list supports.

The filter must be deterministic and testable. A dropped event is logged, not silently forgotten.

## Draft

For each kept event, write two or three variants. Each variant has three fields:

- `hook`: on-screen text for the first 1–3 seconds. One sentence. Specific. No question-bait that the script does not answer.
- `spoken`: what I would actually say. Target 15–30 seconds for a short take, or 45–60 seconds when the change needs more room. Do not pad.
- `caption`: the same facts in written form. No hashtag stuffing.

Rules for the generator are in [voice.md](voice.md). The generator may read the event title, body, and file list. It may quote a file name or a measured number that appears in the event. It may not invent a benchmark, a user count, a deploy URL, or a feature that the event does not contain.

If the event is thin (one-line commit, no body, one file), say so in the draft instead of filling the gap.

Output shape:

```json
{
  "eventId": "github:sgm-audio/blast:commit:abc1234",
  "variants": [
    {
      "id": "…",
      "hook": "…",
      "spoken": "…",
      "caption": "…",
      "targetSeconds": 20
    }
  ],
  "status": "pending_review"
}
```

## Review

Drafts sit in a review queue until a person accepts one variant, rejects the set, or asks for a rewrite.

- `pending_review`
- `approved` (a specific variant was chosen)
- `rejected`
- `needs_rewrite`

Approval means the text is accepted. It does not publish anything.

Export returns the chosen hook, spoken script, and caption as plain text, ready to paste or to hand to a later scheduler. A later Buffer or TikTok step is allowed only after an explicit "send this" from the person who owns the account, and only for that one draft.

## MCP surface

The sellable interface is an MCP server. Same tools for me and for a customer who has connected their own GitHub and Vercel.

Planned tools:

| Tool | What it does |
| --- | --- |
| `list_progress_events` | List ingested events, optionally filtered by source, repo, or time |
| `get_progress_event` | One event by id |
| `draft_scripts` | Write two or three variants for an event |
| `list_drafts` | List drafts by status |
| `get_draft` | One draft by id |
| `approve_draft` | Mark a variant approved; does not post |
| `reject_draft` | Mark a draft rejected |
| `export_draft` | Return approved hook, spoken script, and caption as text |

Not in v1: a tool that posts, schedules, or uploads video.

## Planned layout

When code exists, keep it close to the pipeline:

```
src/ingest/     GitHub and Vercel event adapters
src/filter/     drop/keep rules and tests
src/draft/      variant generator and voice checks
src/mcp/        MCP server that exposes the tools above
docs/           this blueprint, voice, schema, handwritten drafts
```

Stack when implementation starts: TypeScript for the server and MCP, GitHub webhooks plus REST for backfill, Vercel deploy hooks once connected. That choice is proposed, not locked, and no application code exists yet.

## Dogfooding

This repo is the first source. New commits here should be able to produce drafts about BLAST itself. Handwritten drafts live under `docs/drafts/` until the generator exists, and they must match what was actually true when they were written.

## Open questions

- Whether preview deploys are drafted separately from production deploys, or only production is drafted in v1
- Whether merged pull requests replace the individual commits they contain, to avoid duplicate posts
- Where approved drafts are stored long-term (git, a small database, or both)
