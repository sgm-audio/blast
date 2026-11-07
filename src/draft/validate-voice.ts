import type {
  BLASTProgressEvent,
  DraftVariantInput,
  VoiceRuleRecord,
} from '../types.js';

export interface VoiceValidationResult {
  valid: boolean;
  errors: string[];
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s)]+/gi) ?? [];
}

function countHashtags(text: string): number {
  const matches = text.match(/(?:^|\s)#[A-Za-z0-9_]+/g);
  return matches ? matches.length : 0;
}

export function validateDraftVariants(
  variants: DraftVariantInput[],
  event: BLASTProgressEvent,
  voiceRule: VoiceRuleRecord
): VoiceValidationResult {
  const errors: string[] = [];

  if (
    variants.length < voiceRule.min_variants ||
    variants.length > voiceRule.max_variants
  ) {
    errors.push(
      `Variant count must be between ${voiceRule.min_variants} and ${voiceRule.max_variants}, got ${variants.length}.`
    );
  }

  const allowedUrls = new Set<string>(
    [event.url, event.deployUrl ?? '', ...extractUrls(event.body)]
      .filter(Boolean)
      .map((u) => u.replace(/[.,;!?]+$/, '').toLowerCase())
  );

  variants.forEach((v, idx) => {
    const label = `Variant ${idx + 1}`;
    const hookWords = countWords(v.hook);
    if (hookWords < voiceRule.hook_min_words || hookWords > voiceRule.hook_max_words) {
      errors.push(
        `${label}: hook word count must be ${voiceRule.hook_min_words}-${voiceRule.hook_max_words}, got ${hookWords}.`
      );
    }

    const spokenWords = countWords(v.spoken);
    if (spokenWords < voiceRule.min_words || spokenWords > voiceRule.max_words) {
      errors.push(
        `${label}: spoken word count must be ${voiceRule.min_words}-${voiceRule.max_words} (~${voiceRule.default_min_seconds}-${voiceRule.default_max_seconds}s), got ${spokenWords}.`
      );
    }

    if (
      v.targetSeconds < voiceRule.default_min_seconds ||
      v.targetSeconds > voiceRule.default_max_seconds
    ) {
      errors.push(
        `${label}: targetSeconds must be ${voiceRule.default_min_seconds}-${voiceRule.default_max_seconds}, got ${v.targetSeconds}.`
      );
    }

    const combined = `${v.hook}\n${v.spoken}\n${v.caption}`;
    const lowerCombined = combined.toLowerCase();

    for (const phrase of voiceRule.banned_phrases) {
      if (phrase && lowerCombined.includes(phrase.toLowerCase())) {
        errors.push(`${label}: contains banned phrase "${phrase}".`);
      }
    }

    const hashtags = countHashtags(combined);
    if (hashtags > voiceRule.max_hashtags) {
      errors.push(
        `${label}: hashtag count (${hashtags}) exceeds max_hashtags (${voiceRule.max_hashtags}).`
      );
    }

    for (const rawUrl of extractUrls(combined)) {
      const cleaned = rawUrl.replace(/[.,;!?]+$/, '').toLowerCase();
      if (!allowedUrls.has(cleaned)) {
        errors.push(`${label}: contains invented URL "${rawUrl}" not present in the progress event.`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
