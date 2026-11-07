import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  approveDraft,
  editDraftVariant,
  exportApprovedDraft,
  getActiveVoiceRule,
  getDraft,
  getProgressEvent,
  listDrafts,
  listProgressEvents,
  rejectDraft,
  saveDraftWithVariants,
} from '../db/supabase.js';
import { generateDraftVariants } from '../draft/generate-variants.js';
import type { DraftStatus, EventSource, FilterAction } from '../types.js';

export const BLAST_MCP_TOOLS = [
  {
    name: 'list_progress_events',
    description: 'List ingested GitHub/Vercel progress events, optionally filtered by source, repo, or filter_action.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['github', 'vercel'] },
        repo: { type: 'string' },
        filter_action: { type: 'string', enum: ['keep', 'drop'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_progress_event',
    description: 'Fetch a single progress event by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'draft_scripts',
    description: 'Generate 2-3 grounded TikTok variants (hook, spoken, caption) for a kept progress event and store as pending_review.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'list_drafts',
    description: 'List drafts filtered by review status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending_review', 'approved', 'rejected', 'needs_rewrite'],
        },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_draft',
    description: 'Get one draft and its variants by draft id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'edit_draft_variant',
    description: 'Edit a variant hook, spoken script, caption, or targetSeconds before approval.',
    inputSchema: {
      type: 'object',
      properties: {
        draft_id: { type: 'string' },
        variant_id: { type: 'string' },
        hook: { type: 'string' },
        spoken: { type: 'string' },
        caption: { type: 'string' },
        target_seconds: { type: 'number' },
      },
      required: ['draft_id', 'variant_id', 'hook', 'spoken', 'caption', 'target_seconds'],
    },
  },
  {
    name: 'approve_draft',
    description: 'Mark a specific variant approved by a human. Does NOT auto-post anywhere.',
    inputSchema: {
      type: 'object',
      properties: {
        draft_id: { type: 'string' },
        variant_id: { type: 'string' },
      },
      required: ['draft_id', 'variant_id'],
    },
  },
  {
    name: 'reject_draft',
    description: 'Kill/reject a draft set.',
    inputSchema: {
      type: 'object',
      properties: {
        draft_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['draft_id'],
    },
  },
  {
    name: 'export_draft',
    description: 'Export the approved hook, spoken script, and caption as plain text (requires human approval first).',
    inputSchema: {
      type: 'object',
      properties: {
        draft_id: { type: 'string' },
        record_history: { type: 'boolean' },
      },
      required: ['draft_id'],
    },
  },
] as const;

export async function dispatchBlastMcpTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  switch (name) {
    case 'list_progress_events':
      return listProgressEvents({
        source: args.source as EventSource | undefined,
        repo: args.repo as string | undefined,
        filterAction: args.filter_action as FilterAction | undefined,
        limit: args.limit as number | undefined,
      });

    case 'get_progress_event': {
      const found = await getProgressEvent(String(args.id));
      if (!found) {
        throw new Error(`Progress event not found: ${args.id}`);
      }
      return found;
    }

    case 'draft_scripts': {
      const eventId = String(args.event_id);
      const found = await getProgressEvent(eventId);
      if (!found) {
        throw new Error(`Progress event not found: ${eventId}`);
      }
      if (found.filterAction === 'drop') {
        throw new Error(`Cannot draft dropped event ${eventId}: ${found.dropReason}`);
      }
      const voiceRule = await getActiveVoiceRule();
      const { variants, modelUsed } = await generateDraftVariants({
        event: found.event,
        voiceRule,
      });
      return saveDraftWithVariants({
        eventId,
        voiceRuleId: voiceRule.id,
        modelUsed,
        variants,
      });
    }

    case 'list_drafts':
      return listDrafts({
        status: args.status as DraftStatus | undefined,
        limit: args.limit as number | undefined,
      });

    case 'get_draft': {
      const draft = await getDraft(String(args.id));
      if (!draft) {
        throw new Error(`Draft not found: ${args.id}`);
      }
      return draft;
    }

    case 'edit_draft_variant':
      return editDraftVariant({
        draftId: String(args.draft_id),
        variantId: String(args.variant_id),
        hook: String(args.hook),
        spoken: String(args.spoken),
        caption: String(args.caption),
        targetSeconds: Number(args.target_seconds),
      });

    case 'approve_draft':
      return approveDraft({
        draftId: String(args.draft_id),
        variantId: String(args.variant_id),
      });

    case 'reject_draft':
      return rejectDraft({
        draftId: String(args.draft_id),
        reason: args.reason ? String(args.reason) : undefined,
      });

    case 'export_draft':
      return exportApprovedDraft({
        draftId: String(args.draft_id),
        recordHistory: Boolean(args.record_history),
      });

    default:
      throw new Error(`Unknown BLAST MCP tool: ${name}`);
  }
}

export function createBlastMcpServer(): Server {
  const server = new Server(
    { name: 'blast-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...BLAST_MCP_TOOLS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await dispatchBlastMcpTool(
        req.params.name,
        (req.params.arguments as Record<string, unknown>) ?? {}
      );
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  });

  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const server = createBlastMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error('BLAST MCP server failed:', err);
    process.exit(1);
  });
}
