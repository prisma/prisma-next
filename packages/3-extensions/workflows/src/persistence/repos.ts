import type postgres from '@prisma-next/postgres/runtime';
import type { workflowsContract } from './contract';
import { flattenState, hydrateState, type WorkflowState } from './state';

type WorkflowsClient = ReturnType<typeof postgres<typeof workflowsContract>>;
export type WorkflowsOrm = WorkflowsClient['orm'];

export interface WorkflowRunRow {
  readonly id: string;
  readonly workflowId: string;
  readonly status: string;
  readonly currentStepId: string | null;
  readonly waitingSignalId: string | null;
  readonly computeServiceId: string | null;
  readonly computeServiceEndpoint: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface InsertRunInput {
  readonly workflowId: string;
}

export interface UpdateRunStatusOpts {
  readonly waitingSignalId?: string | null;
}

export interface InsertStepRunInput {
  readonly runId: string;
  readonly stepId: string;
  readonly attempt: number;
}

export interface AppendEventInput {
  readonly eventType: string;
  readonly runId: string;
  readonly stepId?: string;
  readonly attempt?: number;
  readonly signalId?: string;
  readonly message?: string;
}

export interface WorkflowRepos {
  insertRun(input: InsertRunInput): Promise<string>;
  loadRun(runId: string): Promise<WorkflowRunRow | null>;
  updateRunStatus(runId: string, status: string, opts?: UpdateRunStatusOpts): Promise<void>;
  updateRunCompute(
    runId: string,
    computeServiceId: string,
    computeServiceEndpoint: string,
  ): Promise<void>;
  replaceStateFields(runId: string, state: WorkflowState): Promise<void>;
  loadStateFields(runId: string): Promise<WorkflowState>;
  insertStepRun(input: InsertStepRunInput): Promise<number>;
  markStepCompleted(stepRunId: number): Promise<void>;
  markStepFailed(stepRunId: number, errorMessage: string): Promise<void>;
  loadCompletedStepIds(runId: string): Promise<Set<string>>;
  appendEvent(input: AppendEventInput): Promise<void>;
}

export function createRepos(orm: WorkflowsOrm): WorkflowRepos {
  return {
    async insertRun({ workflowId }) {
      const row = await orm.WorkflowRun.create({ workflowId, status: 'queued', version: 0 });
      return row.id;
    },

    async loadRun(runId) {
      return orm.WorkflowRun.where({ id: runId }).first();
    },

    async updateRunStatus(runId, status, opts) {
      if (opts !== undefined && 'waitingSignalId' in opts) {
        await orm.WorkflowRun.where({ id: runId }).updateCount({
          status,
          waitingSignalId: opts.waitingSignalId ?? null,
        });
      } else {
        await orm.WorkflowRun.where({ id: runId }).updateCount({ status });
      }
    },

    async updateRunCompute(runId, computeServiceId, computeServiceEndpoint) {
      await orm.WorkflowRun.where({ id: runId }).updateCount({
        computeServiceId,
        computeServiceEndpoint,
      });
    },

    async replaceStateFields(runId, state) {
      await orm.WorkflowStateField.where({ runId }).deleteCount();
      const fields = flattenState(runId, state);
      if (fields.length > 0) {
        await orm.WorkflowStateField.createCount(fields);
      }
    },

    async loadStateFields(runId) {
      const rows = await orm.WorkflowStateField.where({ runId }).all().toArray();
      return hydrateState(rows);
    },

    async insertStepRun({ runId, stepId, attempt }) {
      const row = await orm.WorkflowStepRun.create({
        runId,
        stepId,
        attempt,
        status: 'running',
        startedAt: new Date(),
      });
      return row.id;
    },

    async markStepCompleted(stepRunId) {
      await orm.WorkflowStepRun.where({ id: stepRunId }).updateCount({
        status: 'completed',
        finishedAt: new Date(),
      });
    },

    async markStepFailed(stepRunId, errorMessage) {
      await orm.WorkflowStepRun.where({ id: stepRunId }).updateCount({
        status: 'failed',
        errorMessage,
        finishedAt: new Date(),
      });
    },

    async loadCompletedStepIds(runId) {
      const rows = await orm.WorkflowStepRun.where({ runId, status: 'completed' }).all().toArray();
      return new Set(rows.map((r) => r.stepId));
    },

    async appendEvent({ eventType, runId, stepId, attempt, signalId, message }) {
      await orm.WorkflowEvent.create({
        eventType,
        runId,
        ...(stepId !== undefined ? { stepId } : {}),
        ...(attempt !== undefined ? { attempt } : {}),
        ...(signalId !== undefined ? { signalId } : {}),
        ...(message !== undefined ? { message } : {}),
      });
    },
  };
}
