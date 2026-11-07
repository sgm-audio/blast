import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { getActiveVoiceRule, getBlastDb } from '../src/db/supabase.js';
import { fetchRecentGitHubCommits } from '../src/ingest/github.js';
import { fetchRecentVercelDeployments } from '../src/ingest/vercel.js';

interface CheckResult {
  service: string;
  ok: boolean;
  detail: string;
}

async function runHandshake(): Promise<void> {
  const results: CheckResult[] = [];

  // 1. Supabase Handshake
  try {
    const db = await getBlastDb();
    const rule = await getActiveVoiceRule(db);
    results.push({
      service: 'Supabase (RLS + voice_rules)',
      ok: true,
      detail: `Connected as owner ${db.ownerId}; active rule "${rule.name}" (${rule.default_min_seconds}-${rule.default_max_seconds}s, ${rule.min_words}-${rule.max_words} words, ${rule.min_variants}-${rule.max_variants} variants).`,
    });
  } catch (err) {
    results.push({
      service: 'Supabase (RLS + voice_rules)',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. GitHub REST + MCP Handshake
  const ghToken = process.env.GITHUB_TOKEN;
  const ghRepo = process.env.GITHUB_REPO || 'sgm-audio/blast';
  if (!ghToken) {
    results.push({
      service: 'GitHub (REST + Streamable HTTP MCP)',
      ok: false,
      detail: 'GITHUB_TOKEN missing in .env',
    });
  } else {
    try {
      const commits = await fetchRecentGitHubCommits({
        repo: ghRepo,
        token: ghToken,
        limit: 2,
      });

      const mcpRes = await fetch('https://api.githubcopilot.com/mcp/', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'blast-handshake', version: '0.1.0' },
          },
        }),
      });

      if (!mcpRes.ok) {
        throw new Error(`GitHub MCP HTTP ${mcpRes.status}`);
      }

      results.push({
        service: 'GitHub (REST + Streamable HTTP MCP)',
        ok: true,
        detail: `Fetched ${commits.length} schema-valid commit(s) from ${ghRepo} (latest: ${commits[0]?.event.sha?.slice(0, 7) ?? 'none'}); MCP initialize HTTP ${mcpRes.status}.`,
      });
    } catch (err) {
      results.push({
        service: 'GitHub (REST + Streamable HTTP MCP)',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Vercel Handshake
  const vercelProject = process.env.VERCEL_PROJECT_ID;
  const vercelTeam = process.env.VERCEL_TEAM_ID;
  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelProject || !vercelTeam) {
    results.push({
      service: 'Vercel',
      ok: false,
      detail: 'VERCEL_PROJECT_ID or VERCEL_TEAM_ID missing in .env',
    });
  } else if (!vercelToken) {
    results.push({
      service: 'Vercel',
      ok: true,
      detail: `Linked project ${vercelProject} under ${vercelTeam} (link-only mode; VERCEL_TOKEN optional until deploy-ingest is enabled — 0 deploy events fabricated).`,
    });
  } else {
    try {
      const deploys = await fetchRecentVercelDeployments({
        token: vercelToken,
        teamId: vercelTeam,
        projectId: vercelProject,
        fallbackRepo: ghRepo,
        limit: 2,
      });
      results.push({
        service: 'Vercel',
        ok: true,
        detail: `Verified project ${vercelProject} (${deploys.length} READY deployments).`,
      });
    } catch (err) {
      results.push({
        service: 'Vercel',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Gemini API Handshake
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  if (!geminiKey) {
    results.push({
      service: `Gemini (${geminiModel})`,
      ok: false,
      detail: 'GEMINI_API_KEY is empty in .env — set your Google AI Pro / AI Studio API key to run live draft generation.',
    });
  } else {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const ping = await ai.interactions.create({
        model: geminiModel,
        input: 'Reply with the single word READY.',
        store: false,
      });
      results.push({
        service: `Gemini (${geminiModel})`,
        ok: Boolean(ping.output_text),
        detail: `Interactions API responded: "${(ping.output_text ?? '').trim()}"`,
      });
    } catch (err) {
      results.push({
        service: `Gemini (${geminiModel})`,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log('\n=== BLAST Link Handshake Report ===');
  for (const r of results) {
    console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.service}: ${r.detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

runHandshake().catch((err) => {
  console.error('Fatal handshake error:', err);
  process.exit(1);
});
