# BLAST

Building-in-Public Auto-Poster.

BLAST reads what actually shipped — GitHub commits and pull requests, plus Vercel deploys once that connection exists — and drafts a TikTok hook, a spoken script, and a caption from that event. Nothing posts until a person approves the draft.

This is the same tool I need for my own posts and the same tool other people should be able to point at their own GitHub and Vercel accounts.

## Status

As of 2026-11-07 (America/Regina):

- Written: this README, the [blueprint](docs/blueprint.md), [voice rules](docs/voice.md), and a [progress event schema](docs/progress-event.schema.json).
- Not written: ingest, filtering code, the draft generator, the MCP server, a review UI, or any posting path.
- Connected so far: GitHub (this repo). Vercel is not connected yet, so there are no deploy-based drafts.

If a commit did not happen, there is nothing to post.

## How a draft is supposed to work

1. A progress event arrives (commit, pull request, or deploy).
2. Noise is dropped (lockfile-only changes, generated files, commits marked `[skip content]`).
3. Two or three variants are written: hook, spoken script, caption.
4. A person reviews them.
5. An approved draft can be copied out. Posting is a later step and still requires an explicit go-ahead.

Details are in [docs/blueprint.md](docs/blueprint.md). Voice is in [docs/voice.md](docs/voice.md).

## Day-zero drafts

The first handwritten drafts, written against this repo existing and the product not existing yet, are in [docs/drafts/2026-11-07-day-zero.md](docs/drafts/2026-11-07-day-zero.md).

## License

MIT. See [LICENSE](LICENSE).
