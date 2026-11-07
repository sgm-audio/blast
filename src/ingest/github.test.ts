import { describe, expect, it } from 'vitest';
import { normalizeGitHubCommit, validateProgressEventSchema } from './github.js';

describe('normalizeGitHubCommit', () => {
  it('normalizes a GitHub commit payload into a schema-valid BLASTProgressEvent', () => {
    const rawCommit = {
      sha: '7a30e6e6753eec54b0c1e302cab3d4f333ce2007',
      html_url: 'https://github.com/sgm-audio/blast/commit/7a30e6e6753eec54b0c1e302cab3d4f333ce2007',
      commit: {
        message: 'Add blueprint, voice rules, progress event schema, and day-zero drafts\n\nInitial docs commit.',
        author: {
          date: '2026-11-07T06:47:14Z',
        },
      },
      author: {
        login: 'sgm-audio',
      },
      files: [
        {
          filename: 'docs/blueprint.md',
          status: 'added',
          additions: 171,
          deletions: 0,
          patch: '@@ -0,0 +1,2 @@\n+# BLAST blueprint\n+Purpose...',
        },
      ],
    };

    const bundle = normalizeGitHubCommit('sgm-audio/blast', 'main', rawCommit);
    expect(bundle.event.id).toBe(
      'github:sgm-audio/blast:commit:7a30e6e6753eec54b0c1e302cab3d4f333ce2007'
    );
    expect(bundle.event.title).toBe(
      'Add blueprint, voice rules, progress event schema, and day-zero drafts'
    );
    expect(bundle.event.body).toBe('Initial docs commit.');
    expect(bundle.event.deployUrl).toBeNull();
    expect(bundle.patches).toHaveLength(1);
    expect(validateProgressEventSchema(bundle.event)).toEqual({ valid: true, errors: [] });
  });
});
