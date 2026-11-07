import { describe, expect, it } from 'vitest';
import type { DraftRecord } from '../types.js';
import { formatApprovedDraftExport } from './supabase.js';

function makeSampleDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    id: 'draft-1',
    event_id: 'github:sgm-audio/blast:commit:7a30e6e',
    voice_rule_id: 'rule-1',
    status: 'approved',
    approved_variant_id: 'var-2',
    approved_at: '2026-11-07T01:20:00Z',
    rejected_reason: null,
    model_used: 'gemini-3.8-flash',
    created_at: '2026-11-07T01:15:00Z',
    updated_at: '2026-11-07T01:20:00Z',
    variants: [
      {
        id: 'var-1',
        draft_id: 'draft-1',
        variant_index: 1,
        hook: 'First hook here.',
        spoken: 'First spoken take.',
        caption: 'First caption.',
        targetSeconds: 20,
        spoken_word_count: 3,
        edited_by_human: false,
        created_at: '2026-11-07T01:15:00Z',
        updated_at: '2026-11-07T01:15:00Z',
      },
      {
        id: 'var-2',
        draft_id: 'draft-1',
        variant_index: 2,
        hook: 'If the commit did not happen, neither does the post.',
        spoken: 'Tonight the commit is docs/blueprint.md and docs/voice.md.',
        caption: 'Checked in the blueprint and voice rules.',
        targetSeconds: 21,
        spoken_word_count: 8,
        edited_by_human: true,
        created_at: '2026-11-07T01:15:00Z',
        updated_at: '2026-11-07T01:19:00Z',
      },
    ],
    ...overrides,
  };
}

describe('formatApprovedDraftExport', () => {
  it('refuses to export any draft that has not been explicitly approved by a human', () => {
    expect(() =>
      formatApprovedDraftExport(makeSampleDraft({ status: 'pending_review', approved_variant_id: null }))
    ).toThrow(/must be approved/i);

    expect(() =>
      formatApprovedDraftExport(makeSampleDraft({ status: 'rejected' }))
    ).toThrow(/must be approved/i);
  });

  it('formats the chosen approved variant into plain ready-to-record text', () => {
    const out = formatApprovedDraftExport(makeSampleDraft());
    expect(out).toContain('Hook: If the commit did not happen, neither does the post.');
    expect(out).toContain('Spoken (21s): Tonight the commit is docs/blueprint.md and docs/voice.md.');
    expect(out).toContain('Caption: Checked in the blueprint and voice rules.');
  });
});
