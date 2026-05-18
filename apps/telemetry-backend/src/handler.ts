import { type } from 'arktype';
import type { TelemetryDb } from './db';
import { eventPayloadSchema } from './schema';

export interface RateLimiter {
  allow(key: string): boolean;
}

export interface HandlerDeps {
  readonly db: TelemetryDb;
  readonly rateLimiter?: RateLimiter;
}

const EVENTS_PATH = '/events';

export function createHandler(deps: HandlerDeps) {
  return async function handler(request: Request, info?: { ip?: string }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== EVENTS_PATH) {
      return new Response('Not Found', { status: 404 });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (deps.rateLimiter) {
      const ip = info?.ip ?? request.headers.get('x-forwarded-for') ?? 'unknown';
      const key = ip.split(',')[0]?.trim() || 'unknown';
      if (!deps.rateLimiter.allow(key)) {
        return new Response('Too Many Requests', { status: 429 });
      }
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return new Response('Bad Request: malformed JSON', { status: 400 });
    }

    const parsed = eventPayloadSchema(json);
    if (parsed instanceof type.errors) {
      return new Response(
        JSON.stringify({ error: 'invalid event payload', detail: parsed.summary }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }

    const sqlTable = deps.db.sql['telemetry_event'];
    if (sqlTable === undefined) {
      throw new Error('telemetry_event table missing from contract');
    }
    const plan = sqlTable
      .insert({
        installationId: parsed.installationId,
        version: parsed.version,
        command: parsed.command,
        flags: parsed.flags,
        runtimeName: parsed.runtimeName,
        runtimeVersion: parsed.runtimeVersion,
        os: parsed.os,
        arch: parsed.arch,
        packageManager: parsed.packageManager,
        databaseTarget: parsed.databaseTarget,
        tsVersion: parsed.tsVersion,
        agent: parsed.agent,
        extensions: parsed.extensions,
      })
      .build();

    await deps.db.runtime().execute(plan).toArray();

    return new Response(null, { status: 202 });
  };
}
