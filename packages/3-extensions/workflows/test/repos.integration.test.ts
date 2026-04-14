import postgres from '@prisma-next/postgres/runtime';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { workflowsContract } from '../src/persistence/contract';
import { createRepos, type WorkflowRepos } from '../src/persistence/repos';

// Integration tests for persistence repositories.
// These require a live Postgres instance.
// Run with: DATABASE_URL=<url> pnpm test

const DATABASE_URL = process.env['DATABASE_URL'];
const skip = !DATABASE_URL;

let pool: Pool;
let repos: WorkflowRepos;

beforeAll(async () => {
  if (skip) return;
  pool = new Pool({ connectionString: DATABASE_URL });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pn_workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_step_id TEXT,
      waiting_signal_id TEXT,
      compute_service_id TEXT,
      compute_service_endpoint TEXT,
      version INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS pn_workflow_state_fields (
      id SERIAL PRIMARY KEY,
      run_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_kind TEXT NOT NULL,
      string_value TEXT,
      number_value FLOAT8,
      boolean_value BOOL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS pn_workflow_step_runs (
      id SERIAL PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      attempt INT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS pn_workflow_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      run_id TEXT NOT NULL,
      step_id TEXT,
      attempt INT,
      signal_id TEXT,
      message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const db = postgres({ contract: workflowsContract, pg: pool });
  repos = createRepos(db.orm);
});

afterEach(async () => {
  if (skip) return;
  await pool.query(`
    TRUNCATE pn_workflow_events, pn_workflow_step_runs, pn_workflow_state_fields, pn_workflow_runs;
  `);
});

afterAll(async () => {
  if (skip) return;
  await pool.end();
});

describe('repos — insertRun', () => {
  it.skipIf(skip)('inserts a run row and returns the generated id', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-hello' });
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
  });

  it.skipIf(skip)('sets status to queued and version to 0', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-hello' });
    const run = await repos.loadRun(runId);
    expect(run?.status).toBe('queued');
    expect(run?.version).toBe(0);
  });
});

describe('repos — loadRun', () => {
  it.skipIf(skip)('returns the run row for an existing id', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-load' });
    const run = await repos.loadRun(runId);
    expect(run).not.toBeNull();
    expect(run?.id).toBe(runId);
    expect(run?.workflowId).toBe('wf-load');
  });

  it.skipIf(skip)('returns null for an unknown id', async () => {
    const run = await repos.loadRun('00000000-0000-0000-0000-000000000000');
    expect(run).toBeNull();
  });
});

describe('repos — updateRunStatus', () => {
  it.skipIf(skip)('transitions status from queued to running', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-status' });
    await repos.updateRunStatus(runId, 'running');
    const run = await repos.loadRun(runId);
    expect(run?.status).toBe('running');
  });

  it.skipIf(skip)('sets waitingSignalId when status is waiting_for_signal', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-signal' });
    await repos.updateRunStatus(runId, 'waiting_for_signal', { waitingSignalId: 'sig-abc' });
    const run = await repos.loadRun(runId);
    expect(run?.status).toBe('waiting_for_signal');
    expect(run?.waitingSignalId).toBe('sig-abc');
  });

  it.skipIf(skip)('clears waitingSignalId when status transitions away', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-signal-clear' });
    await repos.updateRunStatus(runId, 'waiting_for_signal', { waitingSignalId: 'sig-abc' });
    await repos.updateRunStatus(runId, 'running', { waitingSignalId: null });
    const run = await repos.loadRun(runId);
    expect(run?.status).toBe('running');
    expect(run?.waitingSignalId).toBeNull();
  });
});

describe('repos — updateRunCompute', () => {
  it.skipIf(skip)('stores compute service id and endpoint on the run row', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-compute' });
    await repos.updateRunCompute(runId, 'svc-123', 'https://svc-123.compute.example.com');
    const run = await repos.loadRun(runId);
    expect(run?.computeServiceId).toBe('svc-123');
    expect(run?.computeServiceEndpoint).toBe('https://svc-123.compute.example.com');
  });
});

describe('repos — replaceStateFields + loadStateFields', () => {
  it.skipIf(skip)('persists all fields and reads them back via hydrateState', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-state' });
    await repos.replaceStateFields(runId, { name: 'alice', age: 30, active: true, score: null });
    const state = await repos.loadStateFields(runId);
    expect(state).toEqual({ name: 'alice', age: 30, active: true, score: null });
  });

  it.skipIf(skip)('overwrites existing fields on a second write', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-state-overwrite' });
    await repos.replaceStateFields(runId, { x: 1 });
    await repos.replaceStateFields(runId, { x: 2, y: 'new' });
    const state = await repos.loadStateFields(runId);
    expect(state).toEqual({ x: 2, y: 'new' });
  });

  it.skipIf(skip)('handles empty state (removes all existing fields)', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-state-empty' });
    await repos.replaceStateFields(runId, { x: 1 });
    await repos.replaceStateFields(runId, {});
    const state = await repos.loadStateFields(runId);
    expect(state).toEqual({});
  });
});

describe('repos — insertStepRun + markStepCompleted', () => {
  it.skipIf(skip)('inserts a step run row and returns its id', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-step' });
    const stepRunId = await repos.insertStepRun({ runId, stepId: 'step-1', attempt: 1 });
    expect(typeof stepRunId).toBe('number');
    expect(stepRunId).toBeGreaterThan(0);
  });

  it.skipIf(skip)('marks the step run as completed with finishedAt', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-step-complete' });
    const stepRunId = await repos.insertStepRun({ runId, stepId: 'step-1', attempt: 1 });
    await repos.markStepCompleted(stepRunId);
    const ids = await repos.loadCompletedStepIds(runId);
    expect(ids.has('step-1')).toBe(true);
  });
});

describe('repos — markStepFailed', () => {
  it.skipIf(skip)('marks the step run as failed and stores the error message', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-step-fail' });
    const stepRunId = await repos.insertStepRun({ runId, stepId: 'step-2', attempt: 1 });
    await repos.markStepFailed(stepRunId, 'something went wrong');
    const result = await pool.query(
      'SELECT status, error_message FROM pn_workflow_step_runs WHERE id = $1',
      [stepRunId],
    );
    expect(result.rows[0]).toMatchObject({
      status: 'failed',
      error_message: 'something went wrong',
    });
  });
});

describe('repos — loadCompletedStepIds', () => {
  it.skipIf(skip)('returns a Set of step ids that have status completed', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-completed' });
    const id1 = await repos.insertStepRun({ runId, stepId: 'step-a', attempt: 1 });
    const id2 = await repos.insertStepRun({ runId, stepId: 'step-b', attempt: 1 });
    await repos.markStepCompleted(id1);
    await repos.markStepCompleted(id2);
    const ids = await repos.loadCompletedStepIds(runId);
    expect(ids).toEqual(new Set(['step-a', 'step-b']));
  });

  it.skipIf(skip)('excludes failed step ids', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-exclude-failed' });
    const id1 = await repos.insertStepRun({ runId, stepId: 'step-a', attempt: 1 });
    const id2 = await repos.insertStepRun({ runId, stepId: 'step-b', attempt: 1 });
    await repos.markStepCompleted(id1);
    await repos.markStepFailed(id2, 'error');
    const ids = await repos.loadCompletedStepIds(runId);
    expect(ids.has('step-a')).toBe(true);
    expect(ids.has('step-b')).toBe(false);
  });

  it.skipIf(skip)('returns an empty set when no steps are completed', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-no-completed' });
    const ids = await repos.loadCompletedStepIds(runId);
    expect(ids.size).toBe(0);
  });
});

describe('repos — appendEvent', () => {
  it.skipIf(skip)('inserts an event row with the correct fields', async () => {
    const runId = await repos.insertRun({ workflowId: 'wf-event' });
    await repos.appendEvent({
      eventType: 'step_started',
      runId,
      stepId: 'step-1',
      attempt: 1,
      message: 'starting step',
    });
    const result = await pool.query(
      'SELECT event_type, run_id, step_id, attempt, message FROM pn_workflow_events WHERE run_id = $1',
      [runId],
    );
    expect(result.rows[0]).toMatchObject({
      event_type: 'step_started',
      run_id: runId,
      step_id: 'step-1',
      attempt: 1,
      message: 'starting step',
    });
  });
});
