export type EventSource = 'github' | 'vercel';
export type EventKind = 'commit' | 'pull_request' | 'deploy';
export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed';

export interface ProgressEventFile {
  path: string;
  status: FileStatus;
  additions?: number | null;
  deletions?: number | null;
}

/**
 * Matches docs/progress-event.schema.json (additionalProperties: false)
 */
export interface BLASTProgressEvent {
  id: string;
  source: EventSource;
  kind: EventKind;
  repo: string;
  sha?: string | null;
  ref?: string | null;
  title: string;
  body: string;
  files: ProgressEventFile[];
  url: string;
  deployUrl?: string | null;
  environment?: string | null;
  timestamp: string;
}

/**
 * Transient diff context passed alongside an event for filter & draft grounding,
 * kept separate from BLASTProgressEvent so schema validation stays strict.
 */
export interface FileDiffPatch {
  path: string;
  patch?: string;
}

export interface IngestedEventBundle {
  event: BLASTProgressEvent;
  patches: FileDiffPatch[];
  authorLogin?: string | null;
}

export type FilterAction = 'keep' | 'drop';

export type DropReasonCode =
  | 'skip_content_tag'
  | 'empty_change'
  | 'rebase_only_pr'
  | 'undescribable_preview_deploy'
  | 'lockfile_only'
  | 'generated_only'
  | 'dependency_bump'
  | 'pure_formatting'
  | 'chore_tooling_config';

export interface FilterDecision {
  action: FilterAction;
  reasonCode: DropReasonCode | null;
  reason: string | null;
}

export interface VoiceRuleRecord {
  id: string;
  owner_id: string;
  name: string;
  is_active: boolean;
  persona: string;
  do_rules: string[];
  dont_rules: string[];
  banned_phrases: string[];
  default_min_seconds: number;
  default_max_seconds: number;
  min_words: number;
  max_words: number;
  hook_min_words: number;
  hook_max_words: number;
  min_variants: number;
  max_variants: number;
  max_hashtags: number;
  raw_markdown: string;
}

export interface DraftVariantInput {
  hook: string;
  spoken: string;
  caption: string;
  targetSeconds: number;
}

export interface DraftVariantRecord extends DraftVariantInput {
  id: string;
  draft_id: string;
  variant_index: number;
  spoken_word_count: number;
  edited_by_human: boolean;
  created_at: string;
  updated_at: string;
}

export type DraftStatus = 'pending_review' | 'approved' | 'rejected' | 'needs_rewrite';

export interface DraftRecord {
  id: string;
  event_id: string;
  voice_rule_id: string | null;
  status: DraftStatus;
  approved_variant_id: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  model_used: string;
  created_at: string;
  updated_at: string;
  variants: DraftVariantRecord[];
  event?: BLASTProgressEvent;
}
