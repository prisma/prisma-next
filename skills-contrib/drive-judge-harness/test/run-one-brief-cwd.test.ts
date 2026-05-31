import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'pathe';
import { type CreateAgent, type OrchestratorRun, runOneBrief } from '../run-one-brief.ts';

const GOLDEN_DIR = fileURLToPath(
  new URL('../../../projects/drive-judge-harness/assets/golden/', import.meta.url),
);
const CASE_DIR = join(GOLDEN_DIR, 'slice-dedupe-generated-imports');

let dir: string;
let runDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rob-cwd-'));
  runDir = mkdtempSync(join(tmpdir(), 'rob-rundir-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(runDir, { recursive: true, force: true });
});

function mockRun(): OrchestratorRun {
  return {
    async *stream() {},
    async wait() {
      return { status: 'finished', runId: null, agentId: null, durationMs: null };
    },
  };
}

describe('runOneBrief — cwd thread-through', () => {
  it('passes runDir as cwd to createAgent on the live path', async () => {
    let capturedCwd: string | undefined;
    const createAgent: CreateAgent = async (opts) => {
      capturedCwd = opts.cwd;
      return mockRun();
    };

    await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile: join(dir, 'run.json'),
        model: 'pinned-model',
        runDir,
        live: true,
        apiKeyPresent: true,
      },
      { createAgent },
    );

    assert.equal(capturedCwd, runDir);
  });

  it('dry-run does not call createAgent regardless of runDir', async () => {
    let called = false;
    const createAgent: CreateAgent = async () => {
      called = true;
      return mockRun();
    };

    await runOneBrief(
      {
        caseDir: CASE_DIR,
        traceFile: join(dir, 'trace.jsonl'),
        manifestFile: join(dir, 'run.json'),
        model: 'pinned-model',
        runDir,
        live: false,
        apiKeyPresent: true,
      },
      { createAgent },
    );

    assert.equal(called, false);
  });
});
