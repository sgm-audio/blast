import type { BLASTProgressEvent, IngestedEventBundle } from '../types.js';
import { validateProgressEventSchema } from './github.js';

export interface RawVercelDeployment {
  uid: string;
  name: string;
  url?: string | null;
  created: number;
  state?: string;
  target?: string | null;
  inspectorUrl?: string | null;
  meta?: {
    githubCommitRepo?: string;
    githubCommitOrg?: string;
    githubCommitSha?: string;
    githubCommitRef?: string;
    githubCommitMessage?: string;
  };
}

export function normalizeVercelDeployment(
  projectId: string,
  fallbackRepo: string,
  raw: RawVercelDeployment
): IngestedEventBundle {
  const repo =
    raw.meta?.githubCommitOrg && raw.meta?.githubCommitRepo
      ? `${raw.meta.githubCommitOrg}/${raw.meta.githubCommitRepo}`
      : fallbackRepo;

  const deployUrl = raw.url ? `https://${raw.url.replace(/^https?:\/\//, '')}` : null;
  const environment = raw.target ?? 'preview';
  const title =
    raw.meta?.githubCommitMessage?.split(/\r?\n/)[0]?.trim() ||
    `Vercel ${environment} deployment for ${raw.name}`;

  const event: BLASTProgressEvent = {
    id: `vercel:${projectId}:deploy:${raw.uid}`,
    source: 'vercel',
    kind: 'deploy',
    repo,
    sha: raw.meta?.githubCommitSha ?? null,
    ref: raw.meta?.githubCommitRef ?? null,
    title,
    body: '',
    files: [],
    url: raw.inspectorUrl ?? deployUrl ?? `https://vercel.com`,
    deployUrl,
    environment,
    timestamp: new Date(raw.created).toISOString(),
  };

  const check = validateProgressEventSchema(event);
  if (!check.valid) {
    throw new Error(`Normalized Vercel deploy failed schema validation: ${check.errors.join('; ')}`);
  }

  return {
    event,
    patches: [],
    authorLogin: null,
  };
}

/**
 * Fetches READY Vercel deployments when VERCEL_TOKEN is configured.
 * Per docs/blueprint.md: when Vercel is not yet active or has 0 deployments,
 * returns [] cleanly and NEVER fakes a deploy event.
 */
export async function fetchRecentVercelDeployments(options: {
  token?: string;
  teamId?: string;
  projectId?: string;
  fallbackRepo: string;
  limit?: number;
}): Promise<IngestedEventBundle[]> {
  const { token, teamId, projectId, fallbackRepo, limit = 5 } = options;
  if (!token || !projectId) {
    return [];
  }

  const url = new URL('https://api.vercel.com/v6/deployments');
  url.searchParams.set('projectId', projectId);
  url.searchParams.set('state', 'READY');
  url.searchParams.set('limit', String(limit));
  if (teamId) {
    url.searchParams.set('teamId', teamId);
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Vercel deployments fetch failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { deployments?: RawVercelDeployment[] };
  return (data.deployments ?? []).map((d) =>
    normalizeVercelDeployment(projectId, fallbackRepo, d)
  );
}
