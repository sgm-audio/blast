import { describe, expect, it } from 'vitest';
import type { DraftRecord } from '../types.js';
import { renderReviewPage } from './render-page.js';

function makeDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    id: 'draft-alpha',
    event_id: 'github:sgm-audio/blast:commit:7a30e6e6753eec54b0c1e302cab3d4f333ce2007',
    voice_rule_id: 'rule-1',
    status: 'pending_review',
    approved_variant_id: null,
    approved_at: null,
    rejected_reason: null,
    model_used: 'gemini-3.8-flash',
    created_at: '2026-11-07T01:15:00Z',
    updated_at: '2026-11-07T01:15:00Z',
    event: {
      id: 'github:sgm-audio/blast:commit:7a30e6e6753eec54b0c1e302cab3d4f333ce2007',
      source: 'github',
      kind: 'commit',
      repo: 'sgm-audio/blast',
      sha: '7a30e6e6753eec54b0c1e302cab3d4f333ce2007',
      ref: 'main',
      title: 'Add blueprint, voice rules, and schema',
      body: '',
      files: [
        { path: 'docs/blueprint.md', status: 'added', additions: 171, deletions: 0 },
        { path: 'docs/voice.md', status: 'added', additions: 33, deletions: 0 },
      ],
      url: 'https://github.com/sgm-audio/blast/commit/7a30e6e6753eec54b0c1e302cab3d4f333ce2007',
      deployUrl: null,
      environment: null,
      timestamp: '2026-11-07T01:00:00Z',
    },
    variants: [
      {
        id: 'var-1',
        draft_id: 'draft-alpha',
        variant_index: 1,
        hook: 'If a commit did not happen, there is nothing to post.',
        spoken: 'Checked in docs/blueprint.md and docs/voice.md tonight. Nothing posts automatically.',
        caption: 'Added the BLAST blueprint and voice rules.',
        targetSeconds: 20,
        spoken_word_count: 10,
        edited_by_human: false,
        created_at: '2026-11-07T01:15:00Z',
        updated_at: '2026-11-07T01:15:00Z',
      },
      {
        id: 'var-2',
        draft_id: 'draft-alpha',
        variant_index: 2,
        hook: 'Wrote the schema before writing any generator code.',
        spoken: 'Two markdown docs in sgm-audio/blast define what counts as progress.',
        caption: 'Schema and voice rules checked into main.',
        targetSeconds: 21,
        spoken_word_count: 10,
        edited_by_human: true,
        created_at: '2026-11-07T01:15:00Z',
        updated_at: '2026-11-07T01:18:00Z',
      },
    ],
    ...overrides,
  };
}

describe('renderReviewPage', () => {
  it('renders empty-queue guidance when no drafts exist', () => {
    const html = renderReviewPage([]);
    expect(html).toContain('npm run sync');
    expect(html).toContain('0 pending');
  });

  it('summarizes pending, approved, and killed counts in the top bar', () => {
    const html = renderReviewPage([
      makeDraft({ id: 'd1', status: 'pending_review' }),
      makeDraft({ id: 'd2', status: 'pending_review' }),
      makeDraft({ id: 'd3', status: 'approved', approved_variant_id: 'var-1' }),
      makeDraft({ id: 'd4', status: 'rejected', rejected_reason: 'Too thin' }),
    ]);

    expect(html).toContain('2 pending');
    expect(html).toContain('1 approved');
    expect(html).toContain('1 killed');
  });

  it('preserves exact Edit, Approve, and Kill form endpoints and field names with collapsible Edit', () => {
    const html = renderReviewPage([makeDraft()]);

    expect(html).toContain('action="/api/drafts/draft-alpha/variants/var-1/edit"');
    expect(html).toContain('name="hook"');
    expect(html).toContain('name="spoken"');
    expect(html).toContain('name="caption"');
    expect(html).toContain('name="targetSeconds"');

    expect(html).toContain('action="/api/drafts/draft-alpha/approve"');
    expect(html).toContain('name="variantId" value="var-1"');

    expect(html).toContain('action="/api/drafts/draft-alpha/kill"');
    expect(html).toContain('name="reason"');

    expect(html).toMatch(/<details[^>]*>[\s\S]*?action="\/api\/drafts\/draft-alpha\/variants\/var-1\/edit"/);
  });

  it('withholds export links and preview until a draft is approved', () => {
    const pendingHtml = renderReviewPage([makeDraft({ status: 'pending_review', approved_variant_id: null })]);
    expect(pendingHtml).not.toContain('/api/drafts/draft-alpha/export');

    const killedHtml = renderReviewPage([makeDraft({ status: 'rejected', approved_variant_id: null })]);
    expect(killedHtml).not.toContain('/api/drafts/draft-alpha/export');

    const approvedHtml = renderReviewPage([
      makeDraft({ status: 'approved', approved_variant_id: 'var-2' }),
    ]);
    expect(approvedHtml).toContain('href="/api/drafts/draft-alpha/export"');
    expect(approvedHtml).toContain('Hook: Wrote the schema before writing any generator code.');
    expect(approvedHtml).toContain('Spoken (21s): Two markdown docs in sgm-audio/blast define what counts as progress.');
  });

  it('escapes untrusted commit titles, script text, and rejection reasons against HTML injection', () => {
    const base = makeDraft({
      status: 'rejected',
      rejected_reason: '<img src=x onerror=alert(1)>',
    });
    base.event!.title = 'Fix <script>alert("xss")</script> & quotes "here"';
    base.variants[0].hook = 'Hook with <tag> & "quote"';

    const html = renderReviewPage([base]);
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Hook with &lt;tag&gt; &amp; &quot;quote&quot;');
  });
});
