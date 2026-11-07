# SOP 01 — Ingest & Deterministic Noise Filter

## Objective
Normalize real repository and deployment events from GitHub and Vercel into `BLASTProgressEvent` ([docs/progress-event.schema.json](../docs/progress-event.schema.json)), then deterministically classify each event as `keep` or `drop` with a required `drop_reason`.

## Inputs
- **GitHub (`src/ingest/github.ts`)**: Commits on default branch and non-empty merged/opened pull requests for `GITHUB_REPO` (`owner/name`), including changed file paths, status, additions, deletions, and raw diff patches (`patch`) when present.
- **Vercel (`src/ingest/vercel.ts`)**: Production or preview deployments for `VERCEL_PROJECT_ID` under `VERCEL_TEAM_ID`. When `VERCEL_TOKEN` is unset or deployment count is `0`, return `[]` cleanly — **never fabricate a deploy event**.

## Stable Event ID Contract
Every normalized event carries an idempotent `id` so re-running sync never creates duplicate drafts:
- GitHub commit: `github:<owner>/<repo>:commit:<sha>`
- GitHub pull request: `github:<owner>/<repo>:pr:<number>:<head_sha>`
- Vercel deploy: `vercel:<project_id>:deploy:<deployment_uid>`

Every object emitted by Layer 3 ingest adapters MUST validate against [docs/progress-event.schema.json](../docs/progress-event.schema.json) (`additionalProperties: false`). Patch text used for formatting/dependency diff inspection is passed alongside the event as transient `FileDiffContext[]`, never mutating the schema object.

## Deterministic Drop Rules (`src/filter/filter-event.ts`)
Evaluate in strict order. First match drops the event and records `drop_reason` in `public.progress_events`:

1. **Explicit skip marker (`skip_content_tag`)**
   - `title` or `body` contains `[skip content]` (case-insensitive).
2. **Empty file list on code event (`empty_change`)**
   - `kind` is `commit` or `pull_request` and `files.length === 0`.
3. **Rebase-only pull request (`rebase_only_pr`)**
   - `kind === 'pull_request'` and `body.trim() === ''` and `title` matches `/^rebase\b/i`.
4. **Preview deploy without describable target (`undescribable_preview_deploy`)**
   - `kind === 'deploy'`, `environment !== 'production'`, and `!deployUrl && !sha`.
5. **Lockfile-only change (`lockfile_only`)**
   - Every file in `files` is a lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `composer.lock`, `Gemfile.lock`, `go.sum`).
6. **Generated output only (`generated_only`)**
   - Every file in `files` is generated build/artifact output (`dist/**`, `build/**`, `.next/**`, `coverage/**`, `*.min.js`, `*.min.css`, `*.map`, `*.pb.go`, `*.generated.*`, `supabase/.temp/**`).
7. **Dependency bump only (`dependency_bump`)**
   - Author/title matches automated dependency bump patterns (`dependabot`, `renovate`, `chore(deps)`, `build(deps)`, `bump <pkg> from <v1> to <v2>`) OR `files` consists solely of manifest + lockfile pairs (`package.json`, `Cargo.toml`, `pyproject.toml`, `requirements*.txt`, plus lockfiles) where diff hunks modify only dependency version fields (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `packageManager`) and no scripts/exports/code.
8. **Pure formatting / whitespace diff (`pure_formatting`)**
   - Commit subject indicates formatting-only (`style:`, `chore: format`, `prettier`, `eslint --fix`, `rustfmt`, `clang-format`) OR patches are provided for all changed files and stripping whitespace, blank lines, trailing commas, quote style (`'` vs `"`), and semicolons produces zero token change between removed (`-`) and added (`+`) lines.
9. **Tooling config `chore:` (`chore_tooling_config`)**
   - `title` starts with `chore:` (case-insensitive) and every file in `files` is tooling/editor/CI metadata (`.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `tsconfig*.json`, `.gitignore`, `.editorconfig`, `.vscode/**`, `.github/**`, `vitest.config.*`, `jest.config.*`).

## Keep Rule
If none of rules 1–9 match, return `{ action: 'keep', reason: null }`. Persist both `keep` and `drop` events to `public.progress_events` so dropped commits are auditable and never re-evaluated unnecessarily.
