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

const NON_SCREEN_FRAMING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /\b(?:slides|slide\s*decks?|slideshows?|powerpoint|keynote|(?:this|next|first|title)\s+slide)\b/i,
    label: 'slides',
  },
  {
    pattern: /\b(?:fake|mock(?:ed)?|placeholder|concept|simulated)\s+dashboards?\b/i,
    label: 'fake dashboard',
  },
  {
    pattern: /\b(?:mockups?|wireframes?|concept\s+(?:ui|screens?))\b/i,
    label: 'mockup/wireframe',
  },
  {
    pattern: /\b(?:abstract|architecture|system)\s+diagrams?\b/i,
    label: 'abstract diagram',
  },
  {
    pattern: /\b(?:flowcharts?|whiteboards?)\b/i,
    label: 'diagram/whiteboard',
  },
  {
    pattern: /\b(?:imagine\s+this|picture\s+this|visualize\s+this|imagine)\b/i,
    label: 'imagine this',
  },
  {
    pattern: /\b(?:b-roll|stock\s+(?:footage|video))\b/i,
    label: 'non-screen footage',
  },
];

const SCREEN_WORK_SURFACE_PATTERN =
  /\b(?:ide|editor|vs\s*code|cursor|neovim|vim|terminal|cli|shell|stdout|stderr|commits?|diffs?|patches|pull\s+requests?|review\s+queue|deploy\s+logs?|build\s+logs?|deployments?|deploys?|deployed|live\s+app|localhost(?::\d+)?)\b/i;

const INLINE_ARTIFACT_PATTERN =
  /(?:https?:\/\/\S+|\b[a-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sql|py|rs|go|cpp|c|h|hpp|css|html|yaml|yml|toml)\b|\b(?:npm|pnpm|yarn|npx|tsx|git|vitest|tsc)\s+[a-z0-9:_-]+)/i;

function findNonScreenFraming(text: string, event: BLASTProgressEvent): string | null {
  for (const { pattern, label } of NON_SCREEN_FRAMING_PATTERNS) {
    if (pattern.test(text)) {
      return label;
    }
  }

  const cleanedTitle = event.title
    .toLowerCase()
    .replace(
      /\b(?:no|ban|bans|reject|rejects|fake|mock(?:ed)?|abstract)\s+(?:fake\s+|abstract\s+)?(?:dashboards?|diagrams?)\b/g,
      ''
    );
  const eventSourceText = [cleanedTitle, ...event.files.map((f) => f.path.toLowerCase())].join(' ');

  if (/\bdashboards?\b/i.test(text) && !eventSourceText.includes('dashboard')) {
    return 'fake dashboard';
  }

  if (/\bdiagrams?\b/i.test(text) && !eventSourceText.includes('diagram')) {
    return 'abstract diagram';
  }

  return null;
}

function hasRecordableScreenAnchor(spoken: string, event: BLASTProgressEvent): boolean {
  if (SCREEN_WORK_SURFACE_PATTERN.test(spoken) || INLINE_ARTIFACT_PATTERN.test(spoken)) {
    return true;
  }

  const lower = spoken.toLowerCase();
  if (event.repo && lower.includes(event.repo.toLowerCase())) {
    return true;
  }
  if (event.sha && event.sha.length >= 7 && lower.includes(event.sha.slice(0, 7).toLowerCase())) {
    return true;
  }
  if (event.deployUrl) {
    const cleanDeploy = event.deployUrl
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    if (cleanDeploy && lower.includes(cleanDeploy)) {
      return true;
    }
  }
  for (const file of event.files) {
    const fullPath = file.path.toLowerCase();
    if (lower.includes(fullPath)) {
      return true;
    }
    const base = fullPath.split('/').pop() ?? '';
    if (base.includes('.') && base.length >= 4 && lower.includes(base)) {
      return true;
    }
  }

  return false;
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

    const nonScreenFraming = findNonScreenFraming(combined, event);
    if (nonScreenFraming) {
      errors.push(
        `${label}: fails proof-of-work screen-recording rule (contains "${nonScreenFraming}"; show actual work in IDE, terminal, commit diff, review queue, deploy log, or live app instead).`
      );
    }

    if (!hasRecordableScreenAnchor(v.spoken, event)) {
      errors.push(
        `${label}: fails proof-of-work screen-recording rule (spoken script must reference actual on-screen work: IDE, terminal, commit diff, review queue, deploy log, or live app).`
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
