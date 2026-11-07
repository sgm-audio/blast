import { GoogleGenAI } from '@google/genai';
import type {
  BLASTProgressEvent,
  DraftVariantInput,
  FileDiffPatch,
  VoiceRuleRecord,
} from '../types.js';
import { validateDraftVariants } from './validate-voice.js';

export class VoiceValidationError extends Error {
  public readonly validationErrors: string[];
  constructor(message: string, validationErrors: string[]) {
    super(message);
    this.name = 'VoiceValidationError';
    this.validationErrors = validationErrors;
  }
}

export interface InteractionsClientLike {
  interactions: {
    create(params: {
      model: string;
      system_instruction?: string;
      input: string;
      store?: boolean;
      response_format?: {
        type: 'text';
        mime_type: 'application/json';
        schema: Record<string, unknown>;
      };
    }): Promise<{ output_text?: string | null }>;
  };
}

function buildResponseSchema(rule: VoiceRuleRecord): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        minItems: rule.min_variants,
        maxItems: rule.max_variants,
        items: {
          type: 'object',
          properties: {
            hook: {
              type: 'string',
              description: `Single phone-readable sentence (${rule.hook_min_words}-${rule.hook_max_words} words). Specific, dry, no clickbait.`,
            },
            spoken: {
              type: 'string',
              description: `First-person spoken script (${rule.min_words}-${rule.max_words} words, ~${rule.default_min_seconds}-${rule.default_max_seconds}s). Sayable, names real files/repo, states what is unfinished.`,
            },
            caption: {
              type: 'string',
              description: '2-4 short factual sentences matching the spoken script. Zero hashtag stuffing.',
            },
            targetSeconds: {
              type: 'integer',
              minimum: rule.default_min_seconds,
              maximum: rule.default_max_seconds,
              description: `Target speaking length in seconds (${rule.default_min_seconds}-${rule.default_max_seconds}).`,
            },
          },
          required: ['hook', 'spoken', 'caption', 'targetSeconds'],
        },
      },
    },
    required: ['variants'],
  };
}

function buildSystemInstruction(rule: VoiceRuleRecord): string {
  return [
    'You are the BLAST draft generator.',
    rule.persona,
    '',
    'Active Voice Rules (Source of Truth from Supabase):',
    rule.raw_markdown,
    '',
    'Hard Deterministic Constraints:',
    `- Produce ${rule.min_variants} to ${rule.max_variants} distinct variants.`,
    `- Every hook MUST be ${rule.hook_min_words} to ${rule.hook_max_words} words (1 sentence).`,
    `- Every spoken script MUST be ${rule.min_words} to ${rule.max_words} words (${rule.default_min_seconds}-${rule.default_max_seconds} seconds). Count words carefully.`,
    `- targetSeconds MUST be an integer between ${rule.default_min_seconds} and ${rule.default_max_seconds}.`,
    `- Max hashtags across hook + spoken + caption: ${rule.max_hashtags} (prefer 0).`,
    `- Banned phrases (never use): ${rule.banned_phrases.join(', ')}.`,
    '- NEVER invent features, metrics, benchmarks, user counts, or deploy URLs not present in the event.',
    '- If deployUrl is null, explicitly avoid claiming anything is deployed.',
    '- If the commit is small or docs-only, state that plainly.',
  ].join('\n');
}

function buildEventInput(
  event: BLASTProgressEvent,
  patches: FileDiffPatch[],
  correctionErrors?: string[]
): string {
  const cappedPatches = patches.slice(0, 8).map((p) => ({
    path: p.path,
    patch: (p.patch ?? '').slice(0, 1200),
  }));

  const sections = [
    'Write 2-3 TikTok draft variants strictly from this verified ProgressEvent and file diff:',
    '',
    'ProgressEvent JSON:',
    JSON.stringify(event, null, 2),
  ];

  if (cappedPatches.length > 0) {
    sections.push('', 'File Diff Excerpts:', JSON.stringify(cappedPatches, null, 2));
  }

  if (correctionErrors && correctionErrors.length > 0) {
    sections.push(
      '',
      'IMPORTANT — Your previous attempt failed deterministic voice validation with these exact errors. Fix EVERY error while staying 100% factual to the ProgressEvent:',
      ...correctionErrors.map((e) => `- ${e}`)
    );
  }

  return sections.join('\n');
}

function parseVariantsJson(rawText: string | null | undefined): DraftVariantInput[] {
  if (!rawText) {
    throw new Error('Gemini returned empty output_text.');
  }
  const parsed = JSON.parse(rawText) as { variants?: DraftVariantInput[] };
  if (!Array.isArray(parsed.variants)) {
    throw new Error('Gemini JSON output missing variants array.');
  }
  return parsed.variants;
}

export async function generateDraftVariants(options: {
  event: BLASTProgressEvent;
  patches?: FileDiffPatch[];
  voiceRule: VoiceRuleRecord;
  model?: string;
  apiKey?: string;
  client?: InteractionsClientLike;
}): Promise<{ variants: DraftVariantInput[]; modelUsed: string }> {
  const {
    event,
    patches = [],
    voiceRule,
    model = process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    apiKey = process.env.GEMINI_API_KEY,
  } = options;

  const client: InteractionsClientLike =
    options.client ??
    (() => {
      if (!apiKey) {
        throw new Error(
          'GEMINI_API_KEY is missing. Set GEMINI_API_KEY in .env before running draft generation.'
        );
      }
      return new GoogleGenAI({ apiKey }) as unknown as InteractionsClientLike;
    })();

  const systemInstruction = buildSystemInstruction(voiceRule);
  const schema = buildResponseSchema(voiceRule);

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const interaction = await client.interactions.create({
      model,
      system_instruction: systemInstruction,
      input: buildEventInput(event, patches, attempt > 1 ? lastErrors : undefined),
      store: false,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema,
      },
    });

    const variants = parseVariantsJson(interaction.output_text);
    const check = validateDraftVariants(variants, event, voiceRule);
    if (check.valid) {
      return { variants, modelUsed: model };
    }
    lastErrors = check.errors;
  }

  throw new VoiceValidationError(
    `Draft variants failed voice validation after retry: ${lastErrors.join(' | ')}`,
    lastErrors
  );
}
