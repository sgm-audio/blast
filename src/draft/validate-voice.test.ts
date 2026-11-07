import { describe, expect, it } from 'vitest';
import type { BLASTProgressEvent, DraftVariantInput, VoiceRuleRecord } from '../types.js';
import { countWords, validateDraftVariants } from './validate-voice.js';

const baseRule: VoiceRuleRecord = {
  id: 'rule-1',
  owner_id: 'owner-1',
  name: 'default',
  is_active: true,
  persona: 'First-person audio-dev forum post.',
  do_rules: ['Lead with what shipped or what failed.'],
  dont_rules: ['No hype.'],
  banned_phrases: ['game-changer', 'just dropped', "you won't believe", "let's go", 'revolutionary'],
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

const sampleEvent: BLASTProgressEvent = {
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

function makeValidVariant(overrides: Partial<DraftVariantInput> = {}): DraftVariantInput {
  return {
    hook: 'There is a repo now, not a product.',
    spoken:
      'I checked the blueprint and voice rules into sgm-audio/blast tonight. docs/blueprint.md defines how commits turn into reviewable scripts, and docs/voice.md blocks hype and invented metrics. Ingest, filtering, and the MCP server still do not exist yet, and Vercel has zero deploys.',
    caption:
      'Checked docs/blueprint.md and docs/voice.md into sgm-audio/blast. No ingest or generator code yet, and nothing posts without approval.',
    targetSeconds: 20,
    ...overrides,
  };
}

describe('validateDraftVariants', () => {
  it('accepts 2 to 3 dry, grounded variants within the 15-25s word window', () => {
    const v1 = makeValidVariant();
    const v2 = makeValidVariant({
      hook: 'If the commit did not happen, neither does the post.',
    });
    expect(countWords(v1.spoken)).toBeGreaterThanOrEqual(38);
    expect(countWords(v1.spoken)).toBeLessThanOrEqual(65);

    const res = validateDraftVariants([v1, v2], sampleEvent, baseRule);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('rejects fewer than 2 or more than 3 variants', () => {
    const res1 = validateDraftVariants([makeValidVariant()], sampleEvent, baseRule);
    expect(res1.valid).toBe(false);
    expect(res1.errors.join(' ')).toMatch(/variant count/i);

    const res4 = validateDraftVariants(
      [makeValidVariant(), makeValidVariant(), makeValidVariant(), makeValidVariant()],
      sampleEvent,
      baseRule
    );
    expect(res4.valid).toBe(false);
  });

  it('rejects spoken scripts outside 38-65 words or targetSeconds outside 15-25s', () => {
    const tooShort = makeValidVariant({
      spoken: 'I added docs/blueprint.md to sgm-audio/blast. Nothing else is built yet.',
      targetSeconds: 12,
    });
    const res = validateDraftVariants([tooShort, makeValidVariant()], sampleEvent, baseRule);
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/spoken word count|targetSeconds/i);
  });

  it('rejects banned hype phrases and hashtag blocks', () => {
    const hyped = makeValidVariant({
      hook: 'Just dropped a game-changer for creators.',
      caption: 'Shipped docs/blueprint.md. #buildinpublic #saas #indiehacker',
    });
    const res = validateDraftVariants([hyped, makeValidVariant()], sampleEvent, baseRule);
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/banned phrase/i);
    expect(res.errors.join(' ')).toMatch(/hashtag/i);
  });

  it('rejects fabricated URLs when deployUrl is null', () => {
    const inventedDeploy = makeValidVariant({
      caption: 'Live now at https://blast-app.vercel.app with the new blueprint.',
    });
    const res = validateDraftVariants([inventedDeploy, makeValidVariant()], sampleEvent, baseRule);
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/invented URL/i);
  });
});
