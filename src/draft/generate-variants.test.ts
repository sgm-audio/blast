import { describe, expect, it } from 'vitest';
import type { BLASTProgressEvent, VoiceRuleRecord } from '../types.js';
import {
  generateDraftVariants,
  type InteractionsClientLike,
  VoiceValidationError,
} from './generate-variants.js';

const testRule: VoiceRuleRecord = {
  id: 'rule-1',
  owner_id: 'owner-1',
  name: 'default',
  is_active: true,
  persona: 'First-person audio-dev forum post.',
  do_rules: ['Lead with what shipped or what failed.', 'Say what is unfinished or broken.'],
  dont_rules: ['Never invent features or metrics not in the diff.'],
  banned_phrases: ['game-changer', 'just dropped', "let's go"],
  default_min_seconds: 15,
  default_max_seconds: 25,
  min_words: 38,
  max_words: 65,
  hook_min_words: 3,
  hook_max_words: 12,
  min_variants: 2,
  max_variants: 3,
  max_hashtags: 1,
  raw_markdown: '# Voice rules',
};

const testEvent: BLASTProgressEvent = {
  id: 'github:sgm-audio/blast:commit:7a30e6e',
  source: 'github',
  kind: 'commit',
  repo: 'sgm-audio/blast',
  sha: '7a30e6e',
  ref: 'main',
  title: 'Add blueprint, voice rules, progress event schema, and day-zero drafts',
  body: '',
  files: [
    { path: 'docs/blueprint.md', status: 'added', additions: 171, deletions: 0 },
    { path: 'docs/voice.md', status: 'added', additions: 33, deletions: 0 },
  ],
  url: 'https://github.com/sgm-audio/blast/commit/7a30e6e',
  deployUrl: null,
  environment: null,
  timestamp: '2026-11-07T00:47:14-06:00',
};

const compliantPayload = JSON.stringify({
  variants: [
    {
      hook: 'There is a repo now, not a product.',
      spoken:
        'I checked docs/blueprint.md and docs/voice.md into sgm-audio/blast tonight. The blueprint lays out commit ingestion and human review, and the voice file bans hype and invented numbers. Ingest, the noise filter, and the MCP server are still not built yet, and Vercel has zero deploys.',
      caption:
        'Added docs/blueprint.md and docs/voice.md to sgm-audio/blast. No ingest or generator code yet, and nothing posts automatically.',
      targetSeconds: 20,
    },
    {
      hook: 'If the commit did not happen, neither does the post.',
      spoken:
        'Tonight the whole commit in sgm-audio/blast is documentation: docs/blueprint.md and docs/voice.md. It specifies how commits become two or three short scripts that wait for explicit human approval. Vercel has zero deployments so far, and the pipeline code itself is still unfinished.',
      caption:
        'Checked in the BLAST blueprint and voice rules on sgm-audio/blast. Pipeline code and Vercel deploys are not live yet.',
      targetSeconds: 21,
    },
  ],
});

describe('generateDraftVariants', () => {
  it('calls Gemini Interactions API without legacy sampling params and returns validated variants', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fakeClient: InteractionsClientLike = {
      interactions: {
        async create(params) {
          calls.push(params as Record<string, unknown>);
          return { output_text: compliantPayload };
        },
      },
    };

    const result = await generateDraftVariants({
      event: testEvent,
      patches: [{ path: 'docs/blueprint.md', patch: '+# BLAST blueprint' }],
      voiceRule: testRule,
      model: 'gemini-3.8-flash',
      client: fakeClient,
    });

    expect(result.variants).toHaveLength(2);
    expect(result.modelUsed).toBe('gemini-3.8-flash');
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('temperature');
    expect(calls[0]).not.toHaveProperty('top_p');
    expect(String(calls[0].input)).toContain('docs/blueprint.md');
  });

  it('performs one corrective retry when initial output fails deterministic voice validation', async () => {
    let callCount = 0;
    const invalidFirstPayload = JSON.stringify({
      variants: [
        {
          hook: 'Just dropped a game-changer.',
          spoken: 'Too short.',
          caption: 'Short.',
          targetSeconds: 20,
        },
        {
          hook: 'Second hook here now.',
          spoken: 'Also too short.',
          caption: 'Short.',
          targetSeconds: 20,
        },
      ],
    });

    const fakeClient: InteractionsClientLike = {
      interactions: {
        async create() {
          callCount += 1;
          return { output_text: callCount === 1 ? invalidFirstPayload : compliantPayload };
        },
      },
    };

    const result = await generateDraftVariants({
      event: testEvent,
      voiceRule: testRule,
      client: fakeClient,
    });

    expect(callCount).toBe(2);
    expect(result.variants).toHaveLength(2);
  });

  it('throws VoiceValidationError if corrective retry still violates voice rules', async () => {
    const alwaysBad = JSON.stringify({
      variants: [
        {
          hook: 'Just dropped a game-changer.',
          spoken: 'Too short.',
          caption: 'Short.',
          targetSeconds: 10,
        },
      ],
    });

    const fakeClient: InteractionsClientLike = {
      interactions: {
        async create() {
          return { output_text: alwaysBad };
        },
      },
    };

    await expect(
      generateDraftVariants({
        event: testEvent,
        voiceRule: testRule,
        client: fakeClient,
      })
    ).rejects.toBeInstanceOf(VoiceValidationError);
  });
});
