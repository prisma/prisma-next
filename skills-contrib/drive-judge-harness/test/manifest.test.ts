import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { join } from 'pathe';
import { type RunManifest, writeManifest } from '../manifest.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'judge-manifest-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const dryRunManifest: RunManifest = {
  schema_version: '1',
  case_slug: 'slice-dedupe-generated-imports',
  model: 'claude-4.6-sonnet-high-thinking',
  runtime: 'claude',
  status: 'dry-run',
  run_id: null,
  agent_id: null,
  trace_file: 'projects/x/trace.jsonl',
  tokens: null,
  wall_clock_ms: null,
  cost_usd: null,
  num_turns: null,
  started_at: '2026-05-30T00:00:00.000Z',
  finished_at: null,
  notes: ['dry-run: live execution gate not satisfied'],
};

describe('writeManifest', () => {
  it('writes pretty-printed JSON that round-trips', () => {
    const path = join(dir, 'run.json');
    writeManifest(path, dryRunManifest);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(parsed, dryRunManifest);
  });

  it('ends the file with a single trailing newline', () => {
    const path = join(dir, 'run.json');
    writeManifest(path, dryRunManifest);
    const content = readFileSync(path, 'utf8');
    assert.ok(content.endsWith('}\n'));
    assert.ok(!content.endsWith('}\n\n'));
  });

  it('creates missing parent directories', () => {
    const path = join(dir, 'nested', 'deeper', 'run.json');
    writeManifest(path, dryRunManifest);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(parsed.case_slug, 'slice-dedupe-generated-imports');
  });

  it('preserves accumulated tokens when present', () => {
    const path = join(dir, 'run.json');
    const withTokens: RunManifest = {
      ...dryRunManifest,
      status: 'finished',
      run_id: 'run-1',
      agent_id: 'agent-1',
      wall_clock_ms: 5000,
      finished_at: '2026-05-30T00:10:00.000Z',
      tokens: {
        inputTokens: 100,
        outputTokens: 40,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        totalTokens: 155,
      },
      notes: [],
    };
    writeManifest(path, withTokens);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(parsed.tokens.totalTokens, 155);
    assert.equal(parsed.status, 'finished');
  });
});
