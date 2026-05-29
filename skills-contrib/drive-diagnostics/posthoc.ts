import { readFileSync } from 'node:fs';

export type Confidence = 'high' | 'medium' | 'low';

// ---------------------------------------------------------------------------
// Reconstructed event shapes
//
// Partial representations of TraceEvent shapes. Some required fields
// (notably `ts`) are genuinely unknown from transcripts — they carry `null`
// rather than an invented value. Do not pass these to the Arktype validator.
// ---------------------------------------------------------------------------

export type ReconstructedDispatchStart = {
  event_type: 'dispatch-start';
  event_id: string;
  schema_version: '1';
  ts: null;
  project_run_id: 'post-hoc';
  orchestrator_agent_id: null;
  dispatch_id: string;
  dispatch_name: string | null;
  subagent_type: string | null;
  model: string | null;
  parent_dispatch_id: null;
};

export type ReconstructedSpecAuthored = {
  event_type: 'spec-authored';
  event_id: string;
  schema_version: '1';
  ts: null;
  project_run_id: 'post-hoc';
  orchestrator_agent_id: null;
  spec_path: string;
  spec_kind: 'project' | 'slice';
  byte_length: null;
  edge_cases_count: null;
  open_questions_count: null;
  dod_items_count: null;
};

export type ReconstructedPlanAuthored = {
  event_type: 'plan-authored';
  event_id: string;
  schema_version: '1';
  ts: null;
  project_run_id: 'post-hoc';
  orchestrator_agent_id: null;
  plan_path: string;
  plan_kind: 'project' | 'slice';
  byte_length: null;
  dispatch_count: null;
  slice_count: null;
  dispatch_size_distribution: null;
  open_items_count: null;
};

export type ReconstructedEvent =
  | ReconstructedDispatchStart
  | ReconstructedSpecAuthored
  | ReconstructedPlanAuthored;

export type PostHocEvent = {
  event: ReconstructedEvent;
  confidence: Confidence;
  origin: 'post-hoc';
};

export type PostHocResult = {
  events: PostHocEvent[];
  operatorTurnCount: number;
  notes: string[];
};

// ---------------------------------------------------------------------------
// Internal type guards — narrow without bare `as` casts
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type ParsedTextItem = { type: 'text'; text: string };
type ParsedToolUseItem = { type: 'tool_use'; name: string; input: Record<string, unknown> };
type ParsedContentItem = ParsedTextItem | ParsedToolUseItem;

function parseContentItem(raw: unknown): ParsedContentItem | null {
  if (!isRecord(raw)) return null;
  if (raw['type'] === 'text' && typeof raw['text'] === 'string') {
    return { type: 'text', text: raw['text'] };
  }
  if (raw['type'] === 'tool_use' && typeof raw['name'] === 'string' && isRecord(raw['input'])) {
    return { type: 'tool_use', name: raw['name'], input: raw['input'] };
  }
  return null;
}

type ParsedTurn = {
  role: 'user' | 'assistant';
  items: ParsedContentItem[];
};

function parseTurnLine(raw: unknown): ParsedTurn | null {
  if (!isRecord(raw)) return null;
  const role = raw['role'];
  if (role !== 'user' && role !== 'assistant') return null;
  const message = raw['message'];
  if (!isRecord(message)) return null;
  const content = message['content'];
  if (!Array.isArray(content)) return null;
  const items: ParsedContentItem[] = [];
  for (const item of content) {
    const parsed = parseContentItem(item);
    if (parsed !== null) items.push(parsed);
  }
  return { role, items };
}

// ---------------------------------------------------------------------------
// Event reconstruction helpers
// ---------------------------------------------------------------------------

function syntheticId(turnIndex: number, itemIndex: number): string {
  return `posthoc-t${String(turnIndex)}-i${String(itemIndex)}`;
}

function reconstructFromToolUse(
  item: ParsedToolUseItem,
  turnIndex: number,
  itemIndex: number,
): PostHocEvent | null {
  if (item.name === 'Task') {
    const input = item.input;
    const dispatch_name = typeof input['description'] === 'string' ? input['description'] : null;
    const model = typeof input['model'] === 'string' ? input['model'] : null;
    const subagent_type =
      typeof input['subagent_type'] === 'string' ? input['subagent_type'] : null;
    const eventId = syntheticId(turnIndex, itemIndex);
    const event: ReconstructedDispatchStart = {
      event_type: 'dispatch-start',
      event_id: eventId,
      schema_version: '1',
      ts: null,
      project_run_id: 'post-hoc',
      orchestrator_agent_id: null,
      dispatch_id: eventId,
      dispatch_name,
      subagent_type,
      model,
      parent_dispatch_id: null,
    };
    return { event, confidence: 'medium', origin: 'post-hoc' };
  }

  if (item.name === 'Write' || item.name === 'StrReplace') {
    const path = typeof item.input['path'] === 'string' ? item.input['path'] : null;
    if (path === null) return null;

    if (path.endsWith('spec.md')) {
      const spec_kind: 'project' | 'slice' = path.includes('slices/') ? 'slice' : 'project';
      const eventId = syntheticId(turnIndex, itemIndex);
      const event: ReconstructedSpecAuthored = {
        event_type: 'spec-authored',
        event_id: eventId,
        schema_version: '1',
        ts: null,
        project_run_id: 'post-hoc',
        orchestrator_agent_id: null,
        spec_path: path,
        spec_kind,
        byte_length: null,
        edge_cases_count: null,
        open_questions_count: null,
        dod_items_count: null,
      };
      return { event, confidence: 'low', origin: 'post-hoc' };
    }

    if (path.endsWith('plan.md')) {
      const plan_kind: 'project' | 'slice' = path.includes('slices/') ? 'slice' : 'project';
      const eventId = syntheticId(turnIndex, itemIndex);
      const event: ReconstructedPlanAuthored = {
        event_type: 'plan-authored',
        event_id: eventId,
        schema_version: '1',
        ts: null,
        project_run_id: 'post-hoc',
        orchestrator_agent_id: null,
        plan_path: path,
        plan_kind,
        byte_length: null,
        dispatch_count: null,
        slice_count: null,
        dispatch_size_distribution: null,
        open_items_count: null,
      };
      return { event, confidence: 'low', origin: 'post-hoc' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseTranscriptFromString(text: string, sourceLabel = '(string)'): PostHocResult {
  const events: PostHocEvent[] = [];
  const notes: string[] = [
    'ts unavailable from transcript — all reconstructed events have ts: null',
  ];
  let operatorTurnCount = 0;

  const lines = text.split('\n');
  let turnIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      notes.push(`${sourceLabel}: unparseable line (skipped)`);
      continue;
    }

    const turn = parseTurnLine(parsed);
    if (turn === null) {
      turnIndex++;
      continue;
    }

    if (turn.role === 'user') {
      operatorTurnCount++;
    } else {
      let itemIndex = 0;
      for (const item of turn.items) {
        if (item.type === 'tool_use') {
          const reconstructed = reconstructFromToolUse(item, turnIndex, itemIndex);
          if (reconstructed !== null) events.push(reconstructed);
        }
        itemIndex++;
      }
    }

    turnIndex++;
  }

  if (events.length === 0) {
    notes.push('no Drive dispatch/authoring signal detected');
  }

  return { events, operatorTurnCount, notes };
}

export function parseTranscript(path: string): PostHocResult {
  const text = readFileSync(path, 'utf-8');
  return parseTranscriptFromString(text, path);
}
