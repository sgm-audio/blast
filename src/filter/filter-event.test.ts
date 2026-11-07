import { describe, expect, it } from 'vitest';
import type { BLASTProgressEvent, FileDiffPatch } from '../types.js';
import { filterProgressEvent } from './filter-event.js';

function makeCommitEvent(overrides: Partial<BLASTProgressEvent> = {}): BLASTProgressEvent {
  return {
    id: 'github:sgm-audio/blast:commit:abc1234',
    source: 'github',
    kind: 'commit',
    repo: 'sgm-audio/blast',
    sha: 'abc1234',
    ref: 'main',
    title: 'Add progress event filter',
    body: '',
    files: [{ path: 'src/filter/filter-event.ts', status: 'added', additions: 42, deletions: 0 }],
    url: 'https://github.com/sgm-audio/blast/commit/abc1234',
    deployUrl: null,
    environment: null,
    timestamp: '2026-11-07T01:00:00-06:00',
    ...overrides,
  };
}

describe('filterProgressEvent', () => {
  it('drops commits marked with [skip content]', () => {
    const decision = filterProgressEvent(
      makeCommitEvent({ title: 'Add internal notes [skip content]' })
    );
    expect(decision.action).toBe('drop');
    expect(decision.reasonCode).toBe('skip_content_tag');
    expect(decision.reason).toBeTruthy();
  });

  it('drops lockfile-only changes', () => {
    const decision = filterProgressEvent(
      makeCommitEvent({
        title: 'Regenerate lockfile',
        files: [
          { path: 'package-lock.json', status: 'modified', additions: 310, deletions: 290 },
          { path: 'pnpm-lock.yaml', status: 'modified', additions: 12, deletions: 12 },
        ],
      })
    );
    expect(decision.action).toBe('drop');
    expect(decision.reasonCode).toBe('lockfile_only');
  });

  it('drops automated dependency bump commits by author or subject', () => {
    const decision = filterProgressEvent(
      makeCommitEvent({
        title: 'chore(deps): bump @supabase/supabase-js from 2.48.0 to 2.49.1',
        files: [
          { path: 'package.json', status: 'modified', additions: 1, deletions: 1 },
          { path: 'package-lock.json', status: 'modified', additions: 25, deletions: 25 },
        ],
      }),
      [],
      'dependabot[bot]'
    );
    expect(decision.action).toBe('drop');
    expect(decision.reasonCode).toBe('dependency_bump');
  });

  it('drops manual package.json + lockfile edits when diff only bumps dependency versions', () => {
    const patches: FileDiffPatch[] = [
      {
        path: 'package.json',
        patch: [
          '@@ -10,4 +10,4 @@',
          '   "dependencies": {',
          '-    "zod": "3.23.8"',
          '+    "zod": "3.24.1"',
          '   }',
        ].join('\n'),
      },
      {
        path: 'package-lock.json',
        patch: '@@ -1,3 +1,3 @@\n-  "version": "3.23.8"\n+  "version": "3.24.1"',
      },
    ];
    const decision = filterProgressEvent(
      makeCommitEvent({
        title: 'Update zod version',
        files: [
          { path: 'package.json', status: 'modified', additions: 1, deletions: 1 },
          { path: 'package-lock.json', status: 'modified', additions: 10, deletions: 10 },
        ],
      }),
      patches
    );
    expect(decision.action).toBe('drop');
    expect(decision.reasonCode).toBe('dependency_bump');
  });

  it('keeps package.json changes when npm scripts are added', () => {
    const patches: FileDiffPatch[] = [
      {
        path: 'package.json',
        patch: [
          '@@ -5,3 +5,4 @@',
          '   "scripts": {',
          '     "test": "vitest run",',
          '+    "sync": "tsx src/pipeline/sync-and-draft.ts"',
          '   }',
        ].join('\n'),
      },
    ];
    const decision = filterProgressEvent(
      makeCommitEvent({
        title: 'Add sync script entry point',
        files: [{ path: 'package.json', status: 'modified', additions: 1, deletions: 0 }],
      }),
      patches
    );
    expect(decision.action).toBe('keep');
    expect(decision.reason).toBeNull();
  });

  it('drops pure whitespace, quote, and semicolon formatting diffs', () => {
    const patches: FileDiffPatch[] = [
      {
        path: 'src/ingest/github.ts',
        patch: [
          '@@ -1,4 +1,6 @@',
          '-const repo = "sgm-audio/blast"',
          '-export function getRepo(){return repo}',
          '+const repo = \'sgm-audio/blast\';',
          '+',
          '+export function getRepo() {',
          '+  return repo;',
          '+}',
        ].join('\n'),
      },
    ];
    const decision = filterProgressEvent(
      makeCommitEvent({
        title: 'Run formatter on github ingest',
        files: [{ path: 'src/ingest/github.ts', status: 'modified', additions: 5, deletions: 2 }],
      }),
      patches
    );
    expect(decision.action).toBe('drop');
    expect(decision.reasonCode).toBe('pure_formatting');
  });

  it('keeps code diffs when actual tokens or behavior change', () => {
    const patches: FileDiffPatch[] = [
      {
        path: 'src/ingest/github.ts',
        patch: [
          '@@ -1,2 +1,2 @@',
          '-const perPage = 10;',
          '+const perPage = 25;',
        ].join('\n'),
      },
    ];
    const decision = filterProgressEvent(
      makeCommitEvent({
        title: 'Fetch 25 commits per backfill page',
        files: [{ path: 'src/ingest/github.ts', status: 'modified', additions: 1, deletions: 1 }],
      }),
      patches
    );
    expect(decision.action).toBe('keep');
    expect(decision.reason).toBeNull();
  });

  it('drops generated build output', () => {
    const decision = filterProgressEvent(
      makeCommitEvent({
        title: 'Rebuild dist output',
        files: [{ path: 'dist/index.js', status: 'modified', additions: 80, deletions: 75 }],
      })
    );
    expect(decision.action).toBe('drop');
    expect(decision.reasonCode).toBe('generated_only');
  });

  it('drops chore: commits that only touch tooling config', () => {
    const decision = filterProgressEvent(
      makeCommitEvent({
        title: 'chore: tighten tsconfig flags',
        files: [{ path: 'tsconfig.json', status: 'modified', additions: 2, deletions: 1 }],
      })
    );
    expect(decision.action).toBe('drop');
    expect(decision.reasonCode).toBe('chore_tooling_config');
  });

  it('drops preview deploys with neither deployUrl nor sha', () => {
    const decision = filterProgressEvent(
      makeCommitEvent({
        id: 'vercel:prj_1:deploy:dpl_1',
        source: 'vercel',
        kind: 'deploy',
        sha: null,
        deployUrl: null,
        environment: 'preview',
        files: [],
      })
    );
    expect(decision.action).toBe('drop');
    expect(decision.reasonCode).toBe('undescribable_preview_deploy');
  });

  it('keeps real blueprint commit 7a30e6e', () => {
    const decision = filterProgressEvent(
      makeCommitEvent({
        id: 'github:sgm-audio/blast:commit:7a30e6e',
        title: 'Add blueprint, voice rules, progress event schema, and day-zero drafts',
        files: [
          { path: 'docs/blueprint.md', status: 'added', additions: 171, deletions: 0 },
          { path: 'docs/voice.md', status: 'added', additions: 33, deletions: 0 },
        ],
      })
    );
    expect(decision.action).toBe('keep');
    expect(decision.reason).toBeNull();
  });
});
