-- BLAST Initial Schema (Source of Truth: Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Voice Rules
CREATE TABLE public.voice_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  persona text NOT NULL,
  do_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  dont_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  banned_phrases jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_min_seconds integer NOT NULL DEFAULT 15,
  default_max_seconds integer NOT NULL DEFAULT 25,
  min_words integer NOT NULL DEFAULT 38,
  max_words integer NOT NULL DEFAULT 65,
  hook_min_words integer NOT NULL DEFAULT 3,
  hook_max_words integer NOT NULL DEFAULT 12,
  min_variants integer NOT NULL DEFAULT 2,
  max_variants integer NOT NULL DEFAULT 3,
  max_hashtags integer NOT NULL DEFAULT 1,
  raw_markdown text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

-- 2. Progress Events (both kept and dropped, with drop_reason logged)
CREATE TABLE public.progress_events (
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id text NOT NULL,
  source text NOT NULL CHECK (source IN ('github', 'vercel')),
  kind text NOT NULL CHECK (kind IN ('commit', 'pull_request', 'deploy')),
  repo text NOT NULL,
  sha text,
  ref text,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  url text NOT NULL,
  deploy_url text,
  environment text,
  event_timestamp timestamptz NOT NULL,
  filter_action text NOT NULL CHECK (filter_action IN ('keep', 'drop')),
  drop_reason text,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id),
  CONSTRAINT drop_reason_required_when_dropped CHECK (
    (filter_action = 'drop' AND drop_reason IS NOT NULL AND length(trim(drop_reason)) > 0)
    OR (filter_action = 'keep' AND drop_reason IS NULL)
  )
);

-- 3. Drafts (one reviewable set per kept progress event)
CREATE TABLE public.drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  voice_rule_id uuid REFERENCES public.voice_rules(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected', 'needs_rewrite')),
  approved_variant_id uuid,
  approved_at timestamptz,
  rejected_reason text,
  model_used text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_id, event_id) REFERENCES public.progress_events(owner_id, id) ON DELETE CASCADE,
  UNIQUE (owner_id, event_id)
);

-- 4. Draft Variants (always 2-3 per draft)
CREATE TABLE public.draft_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_index smallint NOT NULL CHECK (variant_index BETWEEN 1 AND 3),
  hook text NOT NULL,
  spoken text NOT NULL,
  caption text NOT NULL,
  target_seconds integer NOT NULL CHECK (target_seconds BETWEEN 10 AND 60),
  spoken_word_count integer NOT NULL CHECK (spoken_word_count > 0),
  edited_by_human boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, variant_index)
);

ALTER TABLE public.drafts
  ADD CONSTRAINT drafts_approved_variant_fk
  FOREIGN KEY (approved_variant_id) REFERENCES public.draft_variants(id) ON DELETE SET NULL;

-- 5. Posted History (records human-approved exports/posts only; zero auto-posting)
CREATE TABLE public.posted_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.drafts(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.draft_variants(id) ON DELETE RESTRICT,
  platform text NOT NULL DEFAULT 'tiktok',
  external_url text,
  exported_text text NOT NULL,
  approved_by_human boolean NOT NULL DEFAULT true CHECK (approved_by_human = true),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for RLS & query performance
CREATE INDEX idx_voice_rules_owner_active ON public.voice_rules (owner_id, is_active);
CREATE INDEX idx_progress_events_owner_ts ON public.progress_events (owner_id, event_timestamp DESC);
CREATE INDEX idx_progress_events_filter ON public.progress_events (owner_id, filter_action);
CREATE INDEX idx_drafts_owner_status ON public.drafts (owner_id, status, created_at DESC);
CREATE INDEX idx_drafts_voice_rule_id ON public.drafts (voice_rule_id);
CREATE INDEX idx_drafts_approved_variant_id ON public.drafts (approved_variant_id);
CREATE INDEX idx_draft_variants_draft_id ON public.draft_variants (draft_id);
CREATE INDEX idx_draft_variants_owner_id ON public.draft_variants (owner_id);
CREATE INDEX idx_posted_history_owner_recorded ON public.posted_history (owner_id, recorded_at DESC);
CREATE INDEX idx_posted_history_draft_id ON public.posted_history (draft_id);
CREATE INDEX idx_posted_history_variant_id ON public.posted_history (variant_id);

-- Grants to authenticated role (anon gets NO access)
REVOKE ALL ON public.voice_rules, public.progress_events, public.drafts, public.draft_variants, public.posted_history FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_rules, public.progress_events, public.drafts, public.draft_variants, public.posted_history TO authenticated;

-- Enable RLS on every table
ALTER TABLE public.voice_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posted_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies (strict per-owner isolation using (select auth.uid()))
CREATE POLICY voice_rules_select ON public.voice_rules FOR SELECT TO authenticated USING ((select auth.uid()) = owner_id);
CREATE POLICY voice_rules_insert ON public.voice_rules FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY voice_rules_update ON public.voice_rules FOR UPDATE TO authenticated USING ((select auth.uid()) = owner_id) WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY voice_rules_delete ON public.voice_rules FOR DELETE TO authenticated USING ((select auth.uid()) = owner_id);

CREATE POLICY progress_events_select ON public.progress_events FOR SELECT TO authenticated USING ((select auth.uid()) = owner_id);
CREATE POLICY progress_events_insert ON public.progress_events FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY progress_events_update ON public.progress_events FOR UPDATE TO authenticated USING ((select auth.uid()) = owner_id) WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY progress_events_delete ON public.progress_events FOR DELETE TO authenticated USING ((select auth.uid()) = owner_id);

CREATE POLICY drafts_select ON public.drafts FOR SELECT TO authenticated USING ((select auth.uid()) = owner_id);
CREATE POLICY drafts_insert ON public.drafts FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY drafts_update ON public.drafts FOR UPDATE TO authenticated USING ((select auth.uid()) = owner_id) WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY drafts_delete ON public.drafts FOR DELETE TO authenticated USING ((select auth.uid()) = owner_id);

CREATE POLICY draft_variants_select ON public.draft_variants FOR SELECT TO authenticated USING ((select auth.uid()) = owner_id);
CREATE POLICY draft_variants_insert ON public.draft_variants FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY draft_variants_update ON public.draft_variants FOR UPDATE TO authenticated USING ((select auth.uid()) = owner_id) WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY draft_variants_delete ON public.draft_variants FOR DELETE TO authenticated USING ((select auth.uid()) = owner_id);

CREATE POLICY posted_history_select ON public.posted_history FOR SELECT TO authenticated USING ((select auth.uid()) = owner_id);
CREATE POLICY posted_history_insert ON public.posted_history FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY posted_history_update ON public.posted_history FOR UPDATE TO authenticated USING ((select auth.uid()) = owner_id) WITH CHECK ((select auth.uid()) = owner_id);
CREATE POLICY posted_history_delete ON public.posted_history FOR DELETE TO authenticated USING ((select auth.uid()) = owner_id);
