import { readFileSync } from 'node:fs';
import { type } from 'arktype';
import type { TraceEvent } from '../drive-record-traces/schema.ts';
import { KNOWN_EVENT_TYPES, Slice1TraceEvent } from '../drive-record-traces/schema.ts';

export type LoadError = { line: number; raw: string; problem: string };

export type UnknownEvent = {
  line: number;
  raw: string;
  event_type: string;
  origin: 'native';
  unknownType: true;
};

// Events are schema-faithful `TraceEvent`s; provenance (native vs post-hoc)
// is a property of the load source, tracked by the caller, not stamped onto
// the event itself.
export type LoadResult = {
  events: TraceEvent[];
  unknown: UnknownEvent[];
  errors: LoadError[];
};

const KNOWN_EVENT_TYPE_SET = new Set<string>(KNOWN_EVENT_TYPES);

function extractEventType(obj: unknown): string | undefined {
  if (typeof obj !== 'object' || obj === null || !('event_type' in obj)) {
    return undefined;
  }
  const et: unknown = obj.event_type;
  return typeof et === 'string' ? et : undefined;
}

export function loadTraceFromString(text: string, _sourceLabel?: string): LoadResult {
  const events: TraceEvent[] = [];
  const unknown: UnknownEvent[] = [];
  const errors: LoadError[] = [];

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim().length === 0) continue;

    const lineNum = i + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      errors.push({
        line: lineNum,
        raw,
        problem: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const result = Slice1TraceEvent(parsed);
    if (result instanceof type.errors) {
      const eventType = extractEventType(parsed);
      if (eventType !== undefined && !KNOWN_EVENT_TYPE_SET.has(eventType)) {
        unknown.push({
          line: lineNum,
          raw,
          event_type: eventType,
          origin: 'native',
          unknownType: true,
        });
      } else {
        errors.push({ line: lineNum, raw, problem: result.summary });
      }
    } else {
      events.push(result);
    }
  }

  return { events, unknown, errors };
}

export function loadTrace(path: string): LoadResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return {
      events: [],
      unknown: [],
      errors: [
        {
          line: 0,
          raw: '',
          problem: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
  return loadTraceFromString(text, path);
}
