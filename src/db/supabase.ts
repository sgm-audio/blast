import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  BLASTProgressEvent,
  DraftRecord,
  DraftStatus,
  DraftVariantInput,
  DraftVariantRecord,
  EventSource,
  FilterAction,
  FilterDecision,
  ProgressEventFile,
  VoiceRuleRecord,
} from '../types.js';
import { countWords } from '../draft/validate-voice.js';

export interface BlastDbContext {
  client: SupabaseClient;
  ownerId: string;
}

let cachedContext: Promise<BlastDbContext> | null = null;

export async function getBlastDb(): Promise<BlastDbContext> {
  if (!cachedContext) {
    cachedContext = initBlastDb();
  }
  return cachedContext;
}

async function initBlastDb(): Promise<BlastDbContext> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pubKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is missing in environment.');
  }

  if (serviceKey) {
    const client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client
      .from('voice_rules')
      .select('owner_id')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (error || !data?.owner_id) {
      throw new Error(`Failed to resolve owner_id with service role key: ${error?.message ?? 'no active voice_rules row'}`);
    }
    return { client, ownerId: data.owner_id as string };
  }

  if (!pubKey) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY (or SUPABASE_SERVICE_ROLE_KEY) is missing in environment.');
  }

  const email = process.env.BLAST_USER_EMAIL;
  const password = process.env.BLAST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('BLAST_USER_EMAIL and BLAST_USER_PASSWORD are required when SUPABASE_SERVICE_ROLE_KEY is unset.');
  }

  const client = createClient(url, pubKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(`Supabase Auth signInWithPassword failed: ${error?.message ?? 'no user returned'}`);
  }

  return { client, ownerId: data.user.id };
}

export function formatApprovedDraftExport(draft: DraftRecord): string {
  if (draft.status !== 'approved' || !draft.approved_variant_id) {
    throw new Error(
      `Draft ${draft.id} must be approved by a human before export (current status: ${draft.status}).`
    );
  }
  const chosen = draft.variants.find((v) => v.id === draft.approved_variant_id);
  if (!chosen) {
    throw new Error(`Approved variant ${draft.approved_variant_id} not found on draft ${draft.id}.`);
  }

  return [
    `Event: ${draft.event_id}`,
    `Hook: ${chosen.hook}`,
    '',
    `Spoken (${chosen.targetSeconds}s): ${chosen.spoken}`,
    '',
    `Caption: ${chosen.caption}`,
  ].join('\n');
}

function rowToProgressEvent(row: Record<string, unknown>): BLASTProgressEvent {
  return {
    id: row.id as string,
    source: row.source as EventSource,
    kind: row.kind as BLASTProgressEvent['kind'],
    repo: row.repo as string,
    sha: (row.sha as string | null) ?? null,
    ref: (row.ref as string | null) ?? null,
    title: row.title as string,
    body: (row.body as string) ?? '',
    files: (row.files as ProgressEventFile[]) ?? [],
    url: row.url as string,
    deployUrl: (row.deploy_url as string | null) ?? null,
    environment: (row.environment as string | null) ?? null,
    timestamp: new Date(row.event_timestamp as string).toISOString(),
  };
}

function rowToVariant(row: Record<string, unknown>): DraftVariantRecord {
  return {
    id: row.id as string,
    draft_id: row.draft_id as string,
    variant_index: Number(row.variant_index),
    hook: row.hook as string,
    spoken: row.spoken as string,
    caption: row.caption as string,
    targetSeconds: Number(row.target_seconds),
    spoken_word_count: Number(row.spoken_word_count),
    edited_by_human: Boolean(row.edited_by_human),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function getActiveVoiceRule(ctx?: BlastDbContext): Promise<VoiceRuleRecord> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  const { data, error } = await client
    .from('voice_rules')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(`Failed to load active voice_rules row: ${error?.message ?? 'none found'}`);
  }

  return data as VoiceRuleRecord;
}

export async function upsertProgressEvent(
  event: BLASTProgressEvent,
  decision: FilterDecision,
  ctx?: BlastDbContext
): Promise<void> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  const { error } = await client.from('progress_events').upsert(
    {
      owner_id: ownerId,
      id: event.id,
      source: event.source,
      kind: event.kind,
      repo: event.repo,
      sha: event.sha ?? null,
      ref: event.ref ?? null,
      title: event.title,
      body: event.body,
      files: event.files,
      url: event.url,
      deploy_url: event.deployUrl ?? null,
      environment: event.environment ?? null,
      event_timestamp: event.timestamp,
      filter_action: decision.action,
      drop_reason: decision.action === 'drop' ? decision.reason : null,
    },
    { onConflict: 'owner_id,id' }
  );

  if (error) {
    throw new Error(`Failed to upsert progress_event ${event.id}: ${error.message}`);
  }
}

export async function listProgressEvents(
  filters: {
    source?: EventSource;
    repo?: string;
    filterAction?: FilterAction;
    limit?: number;
  } = {},
  ctx?: BlastDbContext
): Promise<Array<{ event: BLASTProgressEvent; filterAction: FilterAction; dropReason: string | null }>> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  let query = client
    .from('progress_events')
    .select('*')
    .eq('owner_id', ownerId)
    .order('event_timestamp', { ascending: false })
    .limit(filters.limit ?? 25);

  if (filters.source) {
    query = query.eq('source', filters.source);
  }
  if (filters.repo) {
    query = query.eq('repo', filters.repo);
  }
  if (filters.filterAction) {
    query = query.eq('filter_action', filters.filterAction);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list progress_events: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    event: rowToProgressEvent(row as Record<string, unknown>),
    filterAction: row.filter_action as FilterAction,
    dropReason: (row.drop_reason as string | null) ?? null,
  }));
}

export async function getProgressEvent(
  eventId: string,
  ctx?: BlastDbContext
): Promise<{ event: BLASTProgressEvent; filterAction: FilterAction; dropReason: string | null } | null> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  const { data, error } = await client
    .from('progress_events')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('id', eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get progress_event ${eventId}: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  return {
    event: rowToProgressEvent(data as Record<string, unknown>),
    filterAction: data.filter_action as FilterAction,
    dropReason: (data.drop_reason as string | null) ?? null,
  };
}

export async function getDraftByEventId(
  eventId: string,
  ctx?: BlastDbContext
): Promise<DraftRecord | null> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  const { data, error } = await client
    .from('drafts')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed checking existing draft for ${eventId}: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return getDraft(data.id as string, ctx);
}

export async function saveDraftWithVariants(
  params: {
    eventId: string;
    voiceRuleId: string;
    modelUsed: string;
    variants: DraftVariantInput[];
  },
  ctx?: BlastDbContext
): Promise<DraftRecord> {
  const { client, ownerId } = ctx ?? (await getBlastDb());

  const { data: draftRow, error: draftErr } = await client
    .from('drafts')
    .upsert(
      {
        owner_id: ownerId,
        event_id: params.eventId,
        voice_rule_id: params.voiceRuleId,
        status: 'pending_review',
        approved_variant_id: null,
        approved_at: null,
        rejected_reason: null,
        model_used: params.modelUsed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id,event_id' }
    )
    .select('*')
    .single();

  if (draftErr || !draftRow) {
    throw new Error(`Failed to upsert draft for ${params.eventId}: ${draftErr?.message ?? 'no row'}`);
  }

  const draftId = draftRow.id as string;

  const { error: delErr } = await client
    .from('draft_variants')
    .delete()
    .eq('owner_id', ownerId)
    .eq('draft_id', draftId);
  if (delErr) {
    throw new Error(`Failed clearing prior variants for draft ${draftId}: ${delErr.message}`);
  }

  const variantRows = params.variants.map((v, idx) => ({
    draft_id: draftId,
    owner_id: ownerId,
    variant_index: idx + 1,
    hook: v.hook,
    spoken: v.spoken,
    caption: v.caption,
    target_seconds: v.targetSeconds,
    spoken_word_count: countWords(v.spoken),
    edited_by_human: false,
  }));

  const { error: varErr } = await client.from('draft_variants').insert(variantRows);
  if (varErr) {
    throw new Error(`Failed inserting variants for draft ${draftId}: ${varErr.message}`);
  }

  const saved = await getDraft(draftId, { client, ownerId });
  if (!saved) {
    throw new Error(`Saved draft ${draftId} could not be reloaded.`);
  }
  return saved;
}

export async function getDraft(
  draftId: string,
  ctx?: BlastDbContext
): Promise<DraftRecord | null> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  const { data: row, error } = await client
    .from('drafts')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('id', draftId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed loading draft ${draftId}: ${error.message}`);
  }
  if (!row) {
    return null;
  }

  const { data: varRows, error: varErr } = await client
    .from('draft_variants')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('draft_id', draftId)
    .order('variant_index', { ascending: true });

  if (varErr) {
    throw new Error(`Failed loading variants for draft ${draftId}: ${varErr.message}`);
  }

  const ev = await getProgressEvent(row.event_id as string, { client, ownerId });

  return {
    id: row.id as string,
    event_id: row.event_id as string,
    voice_rule_id: (row.voice_rule_id as string | null) ?? null,
    status: row.status as DraftStatus,
    approved_variant_id: (row.approved_variant_id as string | null) ?? null,
    approved_at: (row.approved_at as string | null) ?? null,
    rejected_reason: (row.rejected_reason as string | null) ?? null,
    model_used: row.model_used as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    variants: (varRows ?? []).map((vr) => rowToVariant(vr as Record<string, unknown>)),
    event: ev?.event,
  };
}

export async function listDrafts(
  filters: { status?: DraftStatus; limit?: number } = {},
  ctx?: BlastDbContext
): Promise<DraftRecord[]> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  let query = client
    .from('drafts')
    .select('id')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 25);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed listing drafts: ${error.message}`);
  }

  const out: DraftRecord[] = [];
  for (const row of data ?? []) {
    const full = await getDraft(row.id as string, { client, ownerId });
    if (full) {
      out.push(full);
    }
  }
  return out;
}

export async function editDraftVariant(
  params: {
    draftId: string;
    variantId: string;
    hook: string;
    spoken: string;
    caption: string;
    targetSeconds: number;
  },
  ctx?: BlastDbContext
): Promise<DraftRecord> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  const { error } = await client
    .from('draft_variants')
    .update({
      hook: params.hook.trim(),
      spoken: params.spoken.trim(),
      caption: params.caption.trim(),
      target_seconds: params.targetSeconds,
      spoken_word_count: countWords(params.spoken),
      edited_by_human: true,
      updated_at: new Date().toISOString(),
    })
    .eq('owner_id', ownerId)
    .eq('draft_id', params.draftId)
    .eq('id', params.variantId);

  if (error) {
    throw new Error(`Failed editing variant ${params.variantId}: ${error.message}`);
  }

  const updated = await getDraft(params.draftId, { client, ownerId });
  if (!updated) {
    throw new Error(`Draft ${params.draftId} not found after variant edit.`);
  }
  return updated;
}

export async function approveDraft(
  params: { draftId: string; variantId: string },
  ctx?: BlastDbContext
): Promise<DraftRecord> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  const draft = await getDraft(params.draftId, { client, ownerId });
  if (!draft) {
    throw new Error(`Draft ${params.draftId} not found.`);
  }
  if (!draft.variants.some((v) => v.id === params.variantId)) {
    throw new Error(`Variant ${params.variantId} does not belong to draft ${params.draftId}.`);
  }

  const { error } = await client
    .from('drafts')
    .update({
      status: 'approved',
      approved_variant_id: params.variantId,
      approved_at: new Date().toISOString(),
      rejected_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('owner_id', ownerId)
    .eq('id', params.draftId);

  if (error) {
    throw new Error(`Failed approving draft ${params.draftId}: ${error.message}`);
  }

  const approved = await getDraft(params.draftId, { client, ownerId });
  if (!approved) {
    throw new Error(`Draft ${params.draftId} missing after approval.`);
  }
  return approved;
}

export async function rejectDraft(
  params: { draftId: string; reason?: string },
  ctx?: BlastDbContext
): Promise<DraftRecord> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  const { error } = await client
    .from('drafts')
    .update({
      status: 'rejected',
      approved_variant_id: null,
      approved_at: null,
      rejected_reason: params.reason?.trim() || 'Killed in review queue.',
      updated_at: new Date().toISOString(),
    })
    .eq('owner_id', ownerId)
    .eq('id', params.draftId);

  if (error) {
    throw new Error(`Failed rejecting draft ${params.draftId}: ${error.message}`);
  }

  const rejected = await getDraft(params.draftId, { client, ownerId });
  if (!rejected) {
    throw new Error(`Draft ${params.draftId} not found.`);
  }
  return rejected;
}

export async function exportApprovedDraft(
  params: { draftId: string; recordHistory?: boolean },
  ctx?: BlastDbContext
): Promise<{ text: string; draft: DraftRecord }> {
  const { client, ownerId } = ctx ?? (await getBlastDb());
  const draft = await getDraft(params.draftId, { client, ownerId });
  if (!draft) {
    throw new Error(`Draft ${params.draftId} not found.`);
  }

  const text = formatApprovedDraftExport(draft);

  if (params.recordHistory && draft.approved_variant_id) {
    const { error } = await client.from('posted_history').insert({
      owner_id: ownerId,
      draft_id: draft.id,
      variant_id: draft.approved_variant_id,
      platform: 'tiktok',
      exported_text: text,
      approved_by_human: true,
    });
    if (error) {
      throw new Error(`Failed recording export in posted_history: ${error.message}`);
    }
  }

  return { text, draft };
}
