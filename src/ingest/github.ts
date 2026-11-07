import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type {
  BLASTProgressEvent,
  FileDiffPatch,
  FileStatus,
  IngestedEventBundle,
} from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, '../../docs/progress-event.schema.json');
const progressEventSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const addFormats = addFormatsModule.default ?? addFormatsModule;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateEventFn = ajv.compile(progressEventSchema);

export function validateProgressEventSchema(event: BLASTProgressEvent): {
  valid: boolean;
  errors: string[];
} {
  const valid = Boolean(validateEventFn(event));
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validateEventFn.errors ?? []).map(
    (e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`
  );
  return { valid: false, errors };
}

function mapGitHubFileStatus(status: string): FileStatus {
  switch (status) {
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}

export interface RawGitHubCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { date?: string } | null;
    committer?: { date?: string } | null;
  };
  author?: { login?: string } | null;
  files?: Array<{
    filename: string;
    status: string;
    additions?: number;
    deletions?: number;
    patch?: string;
  }>;
}

export function normalizeGitHubCommit(
  repo: string,
  ref: string | null,
  raw: RawGitHubCommit
): IngestedEventBundle {
  const lines = raw.commit.message.split(/\r?\n/);
  const title = (lines[0] ?? '').trim();
  const body = lines.slice(1).join('\n').trim();
  const timestamp =
    raw.commit.author?.date ?? raw.commit.committer?.date ?? new Date().toISOString();

  const files = (raw.files ?? []).map((f) => ({
    path: f.filename,
    status: mapGitHubFileStatus(f.status),
    additions: f.additions ?? null,
    deletions: f.deletions ?? null,
  }));

  const patches: FileDiffPatch[] = (raw.files ?? [])
    .filter((f) => typeof f.patch === 'string')
    .map((f) => ({ path: f.filename, patch: f.patch }));

  const event: BLASTProgressEvent = {
    id: `github:${repo}:commit:${raw.sha}`,
    source: 'github',
    kind: 'commit',
    repo,
    sha: raw.sha,
    ref,
    title,
    body,
    files,
    url: raw.html_url,
    deployUrl: null,
    environment: null,
    timestamp,
  };

  const check = validateProgressEventSchema(event);
  if (!check.valid) {
    throw new Error(`Normalized GitHub commit failed schema validation: ${check.errors.join('; ')}`);
  }

  return {
    event,
    patches,
    authorLogin: raw.author?.login ?? null,
  };
}

export async function fetchRecentGitHubCommits(options: {
  repo: string;
  token: string;
  branch?: string;
  limit?: number;
}): Promise<IngestedEventBundle[]> {
  const { repo, token, limit = 5 } = options;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'blast-ingest/0.1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let branch = options.branch;
  if (!branch) {
    const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
    if (!repoRes.ok) {
      throw new Error(`GitHub repo fetch failed (${repoRes.status}): ${await repoRes.text()}`);
    }
    const repoData = (await repoRes.json()) as { default_branch: string };
    branch = repoData.default_branch;
  }

  const listUrl = new URL(`https://api.github.com/repos/${repo}/commits`);
  listUrl.searchParams.set('sha', branch);
  listUrl.searchParams.set('per_page', String(limit));

  const listRes = await fetch(listUrl, { headers });
  if (!listRes.ok) {
    throw new Error(`GitHub commits list failed (${listRes.status}): ${await listRes.text()}`);
  }
  const summaries = (await listRes.json()) as Array<{ sha: string }>;

  const bundles: IngestedEventBundle[] = [];
  for (const item of summaries) {
    const detailRes = await fetch(`https://api.github.com/repos/${repo}/commits/${item.sha}`, {
      headers,
    });
    if (!detailRes.ok) {
      throw new Error(
        `GitHub commit detail failed for ${item.sha} (${detailRes.status}): ${await detailRes.text()}`
      );
    }
    const detail = (await detailRes.json()) as RawGitHubCommit;
    bundles.push(normalizeGitHubCommit(repo, branch, detail));
  }

  return bundles;
}
