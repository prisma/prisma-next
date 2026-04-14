import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowRepos } from '../src/persistence/repos';
import {
  type AnyStepDef,
  executeWorkflow,
  type WorkflowDef,
} from '../src/runtime/execute-workflow';

function makeRepos(overrides: Partial<WorkflowRepos> = {}): WorkflowRepos {
  return {
    insertRun: vi.fn().mockResolvedValue('run-1'),
    loadRun: vi.fn().mockResolvedValue(null),
    updateRunStatus: vi.fn().mockResolvedValue(undefined),
    updateRunCompute: vi.fn().mockResolvedValue(undefined),
    replaceStateFields: vi.fn().mockResolvedValue(undefined),
    loadStateFields: vi.fn().mockResolvedValue({}),
    insertStepRun: vi.fn().mockResolvedValue(1),
    markStepCompleted: vi.fn().mockResolvedValue(undefined),
    markStepFailed: vi.fn().mockResolvedValue(undefined),
    loadCompletedStepIds: vi.fn().mockResolvedValue(new Set()),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function noop(): Promise<void> {
  return Promise.resolve();
}

describe('executeWorkflow', () => {
  describe('basic execution', () => {
    it('sets status to running at start and completed at end', async () => {
      const repos = makeRepos();
      const def: WorkflowDef = { workflowId: 'wf-1', steps: [] };
      await executeWorkflow({ runId: 'run-1', def, repos, waitForSignal: noop });
      expect(repos.updateRunStatus).toHaveBeenCalledWith('run-1', 'running');
      expect(repos.updateRunStatus).toHaveBeenCalledWith('run-1', 'completed');
    });

    it('appends run_started and run_completed events', async () => {
      const repos = makeRepos();
      const def: WorkflowDef = { workflowId: 'wf-1', steps: [] };
      await executeWorkflow({ runId: 'run-1', def, repos, waitForSignal: noop });
      expect(repos.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'run_started', runId: 'run-1' }),
      );
      expect(repos.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'run_completed', runId: 'run-1' }),
      );
    });

    it('executes steps in order', async () => {
      const order: string[] = [];
      const repos = makeRepos();
      const def: WorkflowDef = {
        workflowId: 'wf-1',
        steps: [
          {
            id: 'step-a',
            execute: async () => {
              order.push('a');
              return {};
            },
          },
          {
            id: 'step-b',
            execute: async () => {
              order.push('b');
              return {};
            },
          },
        ],
      };
      await executeWorkflow({ runId: 'run-1', def, repos, waitForSignal: noop });
      expect(order).toEqual(['a', 'b']);
    });

    it('passes current state to each step and persists returned patch', async () => {
      const repos = makeRepos({
        loadStateFields: vi.fn().mockResolvedValueOnce({ x: 1 }).mockResolvedValueOnce({ x: 2 }),
      });
      const receivedState: unknown[] = [];
      const def: WorkflowDef = {
        workflowId: 'wf-1',
        steps: [
          {
            id: 'step-a',
            execute: async (state) => {
              receivedState.push({ ...state });
              return { x: (state['x'] as number) + 1 };
            },
          },
        ],
      };
      await executeWorkflow({ runId: 'run-1', def, repos, waitForSignal: noop });
      expect(receivedState[0]).toEqual({ x: 1 });
      expect(repos.replaceStateFields).toHaveBeenCalledWith('run-1', { x: 2 });
    });
  });

  describe('step memoization', () => {
    it('skips steps that are already completed', async () => {
      const execute = vi.fn().mockResolvedValue({});
      const repos = makeRepos({
        loadCompletedStepIds: vi.fn().mockResolvedValue(new Set(['step-a'])),
      });
      const def: WorkflowDef = {
        workflowId: 'wf-1',
        steps: [{ id: 'step-a', execute }],
      };
      await executeWorkflow({ runId: 'run-1', def, repos, waitForSignal: noop });
      expect(execute).not.toHaveBeenCalled();
    });

    it('executes only the non-completed step when first step is done', async () => {
      const execA = vi.fn().mockResolvedValue({});
      const execB = vi.fn().mockResolvedValue({});
      const repos = makeRepos({
        loadCompletedStepIds: vi.fn().mockResolvedValue(new Set(['step-a'])),
      });
      const def: WorkflowDef = {
        workflowId: 'wf-1',
        steps: [
          { id: 'step-a', execute: execA },
          { id: 'step-b', execute: execB },
        ],
      };
      await executeWorkflow({ runId: 'run-1', def, repos, waitForSignal: noop });
      expect(execA).not.toHaveBeenCalled();
      expect(execB).toHaveBeenCalledOnce();
    });
  });

  describe('step retry', () => {
    it('retries a failing step up to the retry limit', async () => {
      const execute = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({});
      const repos = makeRepos({
        insertStepRun: vi.fn().mockResolvedValue(1),
      });
      const def: WorkflowDef = {
        workflowId: 'wf-1',
        steps: [
          {
            id: 'step-a',
            retryPolicy: { retries: 3, backoff: 'fixed', baseDelayMs: 0 },
            execute,
          },
        ],
      };
      await executeWorkflow({ runId: 'run-1', def, repos, waitForSignal: noop });
      expect(execute).toHaveBeenCalledTimes(3);
      expect(repos.markStepCompleted).toHaveBeenCalledOnce();
      expect(repos.updateRunStatus).toHaveBeenCalledWith('run-1', 'completed');
    });

    it('marks run as failed when retries are exhausted', async () => {
      const execute = vi.fn().mockRejectedValue(new Error('permanent'));
      const repos = makeRepos();
      const def: WorkflowDef = {
        workflowId: 'wf-1',
        steps: [
          {
            id: 'step-a',
            retryPolicy: { retries: 1, backoff: 'fixed', baseDelayMs: 0 },
            execute,
          },
        ],
      };
      await executeWorkflow({ runId: 'run-1', def, repos, waitForSignal: noop });
      expect(execute).toHaveBeenCalledTimes(2);
      expect(repos.updateRunStatus).toHaveBeenCalledWith('run-1', 'failed');
      expect(repos.updateRunStatus).not.toHaveBeenCalledWith('run-1', 'completed');
    });

    it('records each failed attempt as a step_failed event', async () => {
      const execute = vi.fn().mockRejectedValueOnce(new Error('oops')).mockResolvedValueOnce({});
      const repos = makeRepos();
      const def: WorkflowDef = {
        workflowId: 'wf-1',
        steps: [
          {
            id: 'step-a',
            retryPolicy: { retries: 2, backoff: 'fixed', baseDelayMs: 0 },
            execute,
          },
        ],
      };
      await executeWorkflow({ runId: 'run-1', def, repos, waitForSignal: noop });
      expect(repos.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'step_failed', stepId: 'step-a', attempt: 1 }),
      );
    });
  });

  describe('signal steps', () => {
    it('sets status to waiting_for_signal and waits', async () => {
      let signalResolve!: () => void;
      const signalPromise = new Promise<void>((resolve) => {
        signalResolve = resolve;
      });
      const waitForSignal = vi.fn().mockReturnValue(signalPromise);
      const repos = makeRepos();
      const def: WorkflowDef = {
        workflowId: 'wf-1',
        steps: [{ id: 'step-signal', signalId: 'my-signal' }],
      };
      const runPromise = executeWorkflow({ runId: 'run-1', def, repos, waitForSignal });
      await vi.waitFor(() =>
        expect(repos.updateRunStatus).toHaveBeenCalledWith(
          'run-1',
          'waiting_for_signal',
          expect.objectContaining({ waitingSignalId: 'my-signal' }),
        ),
      );
      signalResolve();
      await runPromise;
      expect(repos.updateRunStatus).toHaveBeenCalledWith('run-1', 'completed');
    });

    it('marks signal step as completed after signal arrives', async () => {
      const repos = makeRepos();
      const def: WorkflowDef = {
        workflowId: 'wf-1',
        steps: [{ id: 'step-signal', signalId: 'approval' }],
      };
      await executeWorkflow({ runId: 'run-1', def, repos, waitForSignal: noop });
      expect(repos.markStepCompleted).toHaveBeenCalledOnce();
    });
  });
});
