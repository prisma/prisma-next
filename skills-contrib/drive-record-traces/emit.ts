import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type } from 'arktype';
import { Slice1TraceEvent } from './schema.ts';

const ENVELOPE_KEYS = [
  'event_id',
  'event_type',
  'schema_version',
  'ts',
  'project_run_id',
  'orchestrator_agent_id',
] as const;

export type EmitInput = {
  traceFile: string;
  projectRunId: string;
  event: string;
  payload: Record<string, unknown>;
  orchestratorAgentId?: string | null;
};

export type EmitResult = { ok: true; line: string } | { ok: false; error: string };

/**
 * Build the envelope, merge with the caller's payload, validate the whole event
 * against the canonical schema, and append one compact JSON line to the trace
 * file. Fail-closed: any validation failure returns `{ ok: false }` and writes
 * nothing. Pure inputs in, deterministic except for `event_id` / `ts`.
 */
export function emitEvent(input: EmitInput): EmitResult {
  for (const key of ENVELOPE_KEYS) {
    if (Object.hasOwn(input.payload, key)) {
      return { ok: false, error: `payload must not contain envelope key "${key}"` };
    }
  }

  const event = {
    event_id: randomUUID(),
    schema_version: '1',
    ts: new Date().toISOString(),
    project_run_id: input.projectRunId,
    orchestrator_agent_id: input.orchestratorAgentId ?? null,
    event_type: input.event,
    ...input.payload,
  };

  const result = Slice1TraceEvent(event);
  if (result instanceof type.errors) {
    return { ok: false, error: result.summary };
  }

  const line = JSON.stringify(event);
  mkdirSync(dirname(input.traceFile), { recursive: true });
  appendFileSync(input.traceFile, `${line}\n`);
  return { ok: true, line };
}

const USAGE =
  'Usage: node skills-contrib/drive-record-traces/emit.ts ' +
  '--trace-file <path> --project-run-id <id> --event <event-type> ' +
  "--payload '<json-object>' [--orchestrator-agent-id <id>]";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parsePayload(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`--payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('--payload must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function main(): void {
  const args = process.argv.slice(2);

  let traceFile: string | undefined;
  let projectRunId: string | undefined;
  let event: string | undefined;
  let payloadRaw: string | undefined;
  let orchestratorAgentId: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    const requireValue = (): string => {
      if (next === undefined) fail(`Missing value for ${arg}\n${USAGE}`);
      i++;
      return next;
    };
    switch (arg) {
      case '--trace-file':
        traceFile = requireValue();
        break;
      case '--project-run-id':
        projectRunId = requireValue();
        break;
      case '--event':
        event = requireValue();
        break;
      case '--payload':
        payloadRaw = requireValue();
        break;
      case '--orchestrator-agent-id':
        orchestratorAgentId = requireValue();
        break;
      default:
        fail(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }

  if (
    traceFile === undefined ||
    projectRunId === undefined ||
    event === undefined ||
    payloadRaw === undefined
  ) {
    fail(USAGE);
  }

  const payload = parsePayload(payloadRaw);

  const result = emitEvent({ traceFile, projectRunId, event, payload, orchestratorAgentId });
  if (!result.ok) {
    fail(result.error);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
