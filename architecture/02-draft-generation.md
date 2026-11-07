# SOP 02 — Grounded Draft Generation & Voice Validation

## Objective
Turn one kept `BLASTProgressEvent` (plus optional file patches) and the active `public.voice_rules` row from Supabase into **2–3 ready-to-record TikTok variants** (`hook`, `spoken`, `caption`, `targetSeconds`), grounded strictly in what actually changed.

## Inputs
1. `event`: Schema-valid `BLASTProgressEvent` (`filter_action = 'keep'`).
2. `patches`: Optional per-file unified diff excerpts (capped to avoid noise) for factual grounding.
3. `voiceRule`: Active row from `public.voice_rules` (`is_active = true`).

## Hard Behavioral Invariants
- **Variant count**: Always `2` or `3` variants (`min_variants = 2`, `max_variants = 3`).
- **Default spoken duration**: `15–25` seconds (`~38–65` words at normal speaking cadence ~150 wpm). Only exceed `65` words when explicitly requested via an override parameter.
- **Hook**: Single sentence, `3–12` words, readable in one glance on a phone. Never ask a question that `spoken` fails to answer.
- **Spoken**: First person (`I`), plain spoken sentences, audio-dev forum register (KVR / JUCE / r/DSP). State what shipped, name concrete files/repo/URLs present in the event, and state what is still unfinished or broken. No closing slogan or call-to-action.
- **Caption**: `2–4` factual sentences matching `spoken`. At most `1` hashtag (and only a factual project tag if used at all; `0` hashtags is preferred).
- **Zero hallucination**: Never invent a feature, metric, benchmark, user count, or deploy URL absent from `event` / `patches`. If `deployUrl` is `null`, never imply the change is deployed.
- **Thin commits stay thin**: If a commit touches 1–2 small files with a one-line message, acknowledge that plainly rather than padding into a grand narrative.

## LLM Execution (`src/draft/generate-variants.ts`)
- SDK: `@google/genai` (`GoogleGenAI`) via the **Interactions API** (`client.interactions.create`).
- Model: `process.env.GEMINI_MODEL || 'gemini-3.8-flash'` (never legacy `gemini-2.5-*`, `gemini-2.0-*`, or `gemini-1.5-*`; never pass deprecated `temperature`/`top_p`/`top_k`).
- Structured output: Pass `response_format: { type: 'text', mime_type: 'application/json', schema }` with `variants` constrained to `minItems: 2, maxItems: 3`.
- Repair pass: Run `validateDraftVariants()` (`src/draft/validate-voice.ts`) deterministically on the parsed response. If a variant violates word-count, banned-phrase, hashtag, or grounding checks, perform at most `1` corrective retry feeding the exact lint errors back into Gemini; if still invalid, throw a typed `VoiceValidationError` rather than persisting non-compliant copy.

## Deterministic Voice Validator (`src/draft/validate-voice.ts`)
Rejects output if any check fails:
1. `variants.length < voiceRule.min_variants || variants.length > voiceRule.max_variants`
2. `hook` word count outside `[voiceRule.hook_min_words, voiceRule.hook_max_words]` (`3..12`)
3. `spoken` word count outside `[voiceRule.min_words, voiceRule.max_words]` (`38..65` by default)
4. `targetSeconds` outside `[voiceRule.default_min_seconds, voiceRule.default_max_seconds]` (`15..25` by default)
5. Any `banned_phrases` substring from `voiceRule` appears in `hook`, `spoken`, or `caption` (case-insensitive)
6. Hashtag count (`/#[A-Za-z0-9_]+/g`) in `hook + spoken + caption` exceeds `voiceRule.max_hashtags` (`1`)
7. `event.deployUrl === null` while draft text fabricates an `https://` URL not present in `event.url` / `event.body`
