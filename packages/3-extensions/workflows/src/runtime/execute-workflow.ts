import type { WorkflowRepos } from '../persistence/repos';
import type { WorkflowState } from '../persistence/state';
import { evalRetryPolicy, isTimedOut, type RetryPolicy } from './retry';

// Type stubs for the workflow definition — M1 will replace these with the full DSL types.

export interface StepDef {
  readonly id: string;
  readonly retryPolicy?: RetryPolicy;
  readonly timeoutMs?: number;
  execute(state: WorkflowState): Promise<Partial<WorkflowState>>;
}

export interface SignalStepDef {
  readonly id: string;
  readonly signalId: string;
}

export type AnyStepDef = StepDef | SignalStepDef;

export interface WorkflowDef {
  readonly workflowId: string;
  readonly steps: readonly AnyStepDef[];
}

export interface ExecuteWorkflowContext {
  readonly runId: string;
  readonly def: WorkflowDef;
  readonly repos: WorkflowRepos;
  waitForSignal(runId: string, signalId: string): Promise<void>;
}

export async function executeWorkflow(ctx: ExecuteWorkflowContext): Promise<void> {
  const { runId, def, repos } = ctx;

  await repos.updateRunStatus(runId, 'running');
  await repos.appendEvent({ eventType: 'run_started', runId });

  const completedStepIds = await repos.loadCompletedStepIds(runId);
  let state = await repos.loadStateFields(runId);

  for (const step of def.steps) {
    if (completedStepIds.has(step.id)) {
      continue;
    }

    if (isSignalStep(step)) {
      await repos.appendEvent({
        eventType: 'awaiting_signal',
        runId,
        stepId: step.id,
        signalId: step.signalId,
      });
      await repos.updateRunStatus(runId, 'waiting_for_signal', { waitingSignalId: step.signalId });
      await ctx.waitForSignal(runId, step.signalId);
      await repos.updateRunStatus(runId, 'running', { waitingSignalId: null });
      const stepRunId = await repos.insertStepRun({ runId, stepId: step.id, attempt: 1 });
      await repos.markStepCompleted(stepRunId);
      await repos.appendEvent({
        eventType: 'signal_received',
        runId,
        stepId: step.id,
        signalId: step.signalId,
      });
      continue;
    }

    const policy = step.retryPolicy ?? { retries: 0, backoff: 'fixed' as const, baseDelayMs: 0 };
    const startedAt = new Date();
    let attempt = 1;

    for (;;) {
      if (step.timeoutMs !== undefined && isTimedOut(startedAt, step.timeoutMs, new Date())) {
        const stepRunId = await repos.insertStepRun({ runId, stepId: step.id, attempt });
        await repos.markStepFailed(stepRunId, 'timeout');
        await repos.appendEvent({
          eventType: 'step_timed_out',
          runId,
          stepId: step.id,
          attempt,
          message: 'timeout',
        });
        await repos.updateRunStatus(runId, 'failed');
        return;
      }

      const stepRunId = await repos.insertStepRun({ runId, stepId: step.id, attempt });
      await repos.appendEvent({ eventType: 'step_started', runId, stepId: step.id, attempt });

      try {
        const patch = await step.execute(state);
        state = { ...state, ...patch };
        await repos.replaceStateFields(runId, state);
        await repos.markStepCompleted(stepRunId);
        await repos.appendEvent({ eventType: 'step_completed', runId, stepId: step.id, attempt });
        break;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await repos.markStepFailed(stepRunId, errorMessage);
        await repos.appendEvent({
          eventType: 'step_failed',
          runId,
          stepId: step.id,
          attempt,
          message: errorMessage,
        });

        const { shouldRetry, delayMs } = evalRetryPolicy(policy, attempt);
        if (!shouldRetry) {
          await repos.updateRunStatus(runId, 'failed');
          return;
        }
        attempt++;
        if (delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
  }

  await repos.updateRunStatus(runId, 'completed');
  await repos.appendEvent({ eventType: 'run_completed', runId });
}

function isSignalStep(step: AnyStepDef): step is SignalStepDef {
  return 'signalId' in step;
}
