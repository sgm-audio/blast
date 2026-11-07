import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import {
  getActiveVoiceRule,
  getBlastDb,
  getDraftByEventId,
  saveDraftWithVariants,
  upsertProgressEvent,
} from '../db/supabase.js';
import { generateDraftVariants } from '../draft/generate-variants.js';
import { filterProgressEvent } from '../filter/filter-event.js';
import { fetchRecentGitHubCommits } from '../ingest/github.js';
import { fetchRecentVercelDeployments } from '../ingest/vercel.js';
import type { DraftRecord } from '../types.js';

export interface SyncSummary {
  ingested: number;
  kept: number;
  dropped: Array<{ eventId: string; reason: string }>;
  skippedExisting: string[];
  drafted: DraftRecord[];
}

export async function syncAndDraft(options: {
  limit?: number;
  maxNewDrafts?: number;
  force?: boolean;
} = {}): Promise<SyncSummary> {
  const { limit = 5, maxNewDrafts = 1, force = false } = options;
  const repo = process.env.GITHUB_REPO || 'sgm-audio/blast';
  const ghToken = process.env.GITHUB_TOKEN;
  if (!ghToken) {
    throw new Error('GITHUB_TOKEN is required in .env to run sync.');
  }

  const db = await getBlastDb();
  const voiceRule = await getActiveVoiceRule(db);

  const [ghBundles, vercelBundles] = await Promise.all([
    fetchRecentGitHubCommits({ repo, token: ghToken, limit }),
    fetchRecentVercelDeployments({
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      fallbackRepo: repo,
      limit,
    }),
  ]);

  const allBundles = [...ghBundles, ...vercelBundles];
  const summary: SyncSummary = {
    ingested: allBundles.length,
    kept: 0,
    dropped: [],
    skippedExisting: [],
    drafted: [],
  };

  for (const bundle of allBundles) {
    const decision = filterProgressEvent(bundle.event, bundle.patches, bundle.authorLogin);
    await upsertProgressEvent(bundle.event, decision, db);

    if (decision.action === 'drop') {
      summary.dropped.push({
        eventId: bundle.event.id,
        reason: decision.reason ?? 'Dropped by filter.',
      });
      continue;
    }

    summary.kept += 1;

    if (!force) {
      const existing = await getDraftByEventId(bundle.event.id, db);
      if (existing) {
        summary.skippedExisting.push(bundle.event.id);
        continue;
      }
    }

    if (summary.drafted.length >= maxNewDrafts) {
      continue;
    }

    const { variants, modelUsed } = await generateDraftVariants({
      event: bundle.event,
      patches: bundle.patches,
      voiceRule,
    });

    const saved = await saveDraftWithVariants(
      {
        eventId: bundle.event.id,
        voiceRuleId: voiceRule.id,
        modelUsed,
        variants,
      },
      db
    );
    summary.drafted.push(saved);
  }

  return summary;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const maxArg = process.argv.find((a) => a.startsWith('--max-drafts='));
  const force = process.argv.includes('--force');

  syncAndDraft({
    limit: limitArg ? Number(limitArg.split('=')[1]) : 5,
    maxNewDrafts: maxArg ? Number(maxArg.split('=')[1]) : 1,
    force,
  })
    .then((res) => {
      console.log('\n=== BLAST Sync & Draft Summary ===');
      console.log(`Ingested events: ${res.ingested}`);
      console.log(`Kept events:     ${res.kept}`);
      console.log(`Dropped events:  ${res.dropped.length}`);
      for (const d of res.dropped) {
        console.log(`  - [DROP] ${d.eventId}: ${d.reason}`);
      }
      if (res.skippedExisting.length > 0) {
        console.log(`Existing drafts skipped: ${res.skippedExisting.length}`);
      }
      console.log(`New draft sets created:  ${res.drafted.length}`);
      for (const draft of res.drafted) {
        console.log(`\nDraft ${draft.id} (${draft.status}) for ${draft.event_id}:`);
        for (const v of draft.variants) {
          console.log(`  Variant ${v.variant_index} (${v.targetSeconds}s, ${v.spoken_word_count} words):`);
          console.log(`    Hook:    ${v.hook}`);
          console.log(`    Spoken:  ${v.spoken}`);
          console.log(`    Caption: ${v.caption}`);
        }
      }
    })
    .catch((err) => {
      console.error('Sync failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
