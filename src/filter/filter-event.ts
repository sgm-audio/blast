import path from 'node:path';
import type {
  BLASTProgressEvent,
  FileDiffPatch,
  FilterDecision,
} from '../types.js';

const LOCKFILE_BASENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'uv.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
]);

const MANIFEST_BASENAMES = new Set([
  'package.json',
  'cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
]);

const DEP_SECTIONS = new Set([
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'overrides',
  'resolutions',
]);

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function isLockfile(filePath: string): boolean {
  const base = path.posix.basename(normalizePath(filePath)).toLowerCase();
  return LOCKFILE_BASENAMES.has(base);
}

function isGeneratedFile(filePath: string): boolean {
  const norm = normalizePath(filePath).toLowerCase();
  if (
    norm.startsWith('dist/') ||
    norm.startsWith('build/') ||
    norm.startsWith('.next/') ||
    norm.startsWith('coverage/') ||
    norm.startsWith('supabase/.temp/')
  ) {
    return true;
  }
  return (
    norm.endsWith('.min.js') ||
    norm.endsWith('.min.css') ||
    norm.endsWith('.map') ||
    norm.endsWith('.pb.go') ||
    norm.includes('.generated.')
  );
}

function isToolingConfigFile(filePath: string): boolean {
  const norm = normalizePath(filePath);
  const base = path.posix.basename(norm).toLowerCase();
  if (norm.startsWith('.github/') || norm.startsWith('.vscode/')) {
    return true;
  }
  return (
    base === '.gitignore' ||
    base === '.editorconfig' ||
    base.startsWith('.eslintrc') ||
    base.startsWith('eslint.config.') ||
    base.startsWith('.prettierrc') ||
    base.startsWith('prettier.config.') ||
    (base.startsWith('tsconfig') && base.endsWith('.json')) ||
    base.startsWith('vitest.config.') ||
    base.startsWith('jest.config.')
  );
}

function isAutomatedDepBump(title: string, authorLogin?: string | null): boolean {
  const login = (authorLogin ?? '').toLowerCase();
  if (login.includes('dependabot') || login.includes('renovate')) {
    return true;
  }
  return (
    /^(chore|build)\(deps(-dev)?\):/i.test(title.trim()) ||
    /\bbump\s+\S+\s+from\s+\S+\s+to\s+\S+/i.test(title)
  );
}

function isPackageJsonDepOnlyPatch(patch: string): boolean {
  const lines = patch.split(/\r?\n/);
  let currentSection: string | null = null;
  let sawChangedLine = false;

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      continue;
    }
    const content = line.slice(1);
    const sectionMatch = content.match(/^\s*"([^"]+)"\s*:\s*\{/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
    } else if (/^\s*\}/.test(content)) {
      currentSection = null;
    }

    if (line.startsWith('+') || line.startsWith('-')) {
      sawChangedLine = true;
      const trimmed = content.trim().replace(/,$/, '');
      if (trimmed === '' || trimmed === '{' || trimmed === '}') {
        continue;
      }
      if (/^"packageManager"\s*:\s*"[^"]+"$/.test(trimmed)) {
        continue;
      }
      if (currentSection && !DEP_SECTIONS.has(currentSection)) {
        return false;
      }
      const kv = trimmed.match(/^"([^"]+)"\s*:\s*"([^"]+)"$/);
      if (!kv) {
        return false;
      }
      const val = kv[2];
      const looksLikeVersion =
        /^[\^~>=<*0-9v]/.test(val) ||
        /^(workspace:|npm:|catalog:|file:|git\+|github:)/.test(val);
      if (!looksLikeVersion) {
        return false;
      }
    }
  }

  return sawChangedLine;
}

function isDependencyBumpOnly(
  event: BLASTProgressEvent,
  patches: FileDiffPatch[],
  authorLogin?: string | null
): boolean {
  if (isAutomatedDepBump(event.title, authorLogin)) {
    return true;
  }
  if (event.files.length === 0) {
    return false;
  }

  const allManifestOrLock = event.files.every((f) => {
    const base = path.posix.basename(normalizePath(f.path)).toLowerCase();
    return LOCKFILE_BASENAMES.has(base) || MANIFEST_BASENAMES.has(base);
  });
  if (!allManifestOrLock) {
    return false;
  }

  const manifestFiles = event.files.filter((f) => !isLockfile(f.path));
  if (manifestFiles.length === 0) {
    return false;
  }

  const patchByPath = new Map(patches.map((p) => [normalizePath(p.path), p.patch]));
  return manifestFiles.every((mf) => {
    const norm = normalizePath(mf.path);
    const base = path.posix.basename(norm).toLowerCase();
    const patch = patchByPath.get(norm);
    if (!patch) {
      return false;
    }
    if (base === 'package.json') {
      return isPackageJsonDepOnlyPatch(patch);
    }
    return false;
  });
}

function normalizeFormattingStream(code: string): string {
  return code
    .replace(/'([^'\\]|\\.)*'/g, (match) => {
      const inner = match.slice(1, -1).replace(/"/g, '\\"');
      return `"${inner}"`;
    })
    .replace(/;/g, '')
    .replace(/,(\s*[}\])])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*([{}()[\].,:=+\-/*<>!&|?])\s*/g, '$1');
}

function isPureFormattingPatch(patch: string): boolean {
  const removed: string[] = [];
  const added: string[] = [];

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('-')) {
      removed.push(line.slice(1));
    } else if (line.startsWith('+')) {
      added.push(line.slice(1));
    }
  }

  if (removed.length === 0 && added.length === 0) {
    return true;
  }

  return normalizeFormattingStream(removed.join('\n')) === normalizeFormattingStream(added.join('\n'));
}

function isPureFormattingEvent(event: BLASTProgressEvent, patches: FileDiffPatch[]): boolean {
  if (/^(style:|chore:\s*(format|prettier|eslint\s+--fix))/i.test(event.title.trim())) {
    return true;
  }
  if (event.kind === 'deploy' || event.files.length === 0) {
    return false;
  }
  if (event.files.some((f) => f.status !== 'modified')) {
    return false;
  }

  const patchByPath = new Map(patches.map((p) => [normalizePath(p.path), p.patch]));
  return event.files.every((f) => {
    const patch = patchByPath.get(normalizePath(f.path));
    return typeof patch === 'string' && patch.length > 0 && isPureFormattingPatch(patch);
  });
}

export function filterProgressEvent(
  event: BLASTProgressEvent,
  patches: FileDiffPatch[] = [],
  authorLogin?: string | null
): FilterDecision {
  const combinedText = `${event.title}\n${event.body}`;
  if (/\[skip content\]/i.test(combinedText)) {
    return {
      action: 'drop',
      reasonCode: 'skip_content_tag',
      reason: 'Commit or PR contains [skip content].',
    };
  }

  if (event.kind !== 'deploy' && event.files.length === 0) {
    return {
      action: 'drop',
      reasonCode: 'empty_change',
      reason: 'No changed files present on commit or pull request.',
    };
  }

  if (
    event.kind === 'pull_request' &&
    event.body.trim() === '' &&
    /^rebase\b/i.test(event.title.trim())
  ) {
    return {
      action: 'drop',
      reasonCode: 'rebase_only_pr',
      reason: 'Pull request only rebases another branch with an empty description.',
    };
  }

  if (
    event.kind === 'deploy' &&
    event.environment !== 'production' &&
    !event.deployUrl &&
    !event.sha
  ) {
    return {
      action: 'drop',
      reasonCode: 'undescribable_preview_deploy',
      reason: 'Preview deploy has neither a deployUrl nor an associated git SHA.',
    };
  }

  if (event.files.length > 0 && event.files.every((f) => isLockfile(f.path))) {
    return {
      action: 'drop',
      reasonCode: 'lockfile_only',
      reason: 'Only lockfiles were modified.',
    };
  }

  if (event.files.length > 0 && event.files.every((f) => isGeneratedFile(f.path))) {
    return {
      action: 'drop',
      reasonCode: 'generated_only',
      reason: 'Only generated build or artifact files were modified.',
    };
  }

  if (isDependencyBumpOnly(event, patches, authorLogin)) {
    return {
      action: 'drop',
      reasonCode: 'dependency_bump',
      reason: 'Commit only bumps dependency versions.',
    };
  }

  if (isPureFormattingEvent(event, patches)) {
    return {
      action: 'drop',
      reasonCode: 'pure_formatting',
      reason: 'Diff contains only whitespace, quote, semicolon, or formatting changes.',
    };
  }

  if (
    /^chore:/i.test(event.title.trim()) &&
    event.files.length > 0 &&
    event.files.every((f) => isToolingConfigFile(f.path))
  ) {
    return {
      action: 'drop',
      reasonCode: 'chore_tooling_config',
      reason: 'chore: commit touches only tooling configuration.',
    };
  }

  return {
    action: 'keep',
    reasonCode: null,
    reason: null,
  };
}
