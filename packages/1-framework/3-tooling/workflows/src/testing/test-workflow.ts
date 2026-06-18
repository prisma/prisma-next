import { createWorkflowRuntime, type WorkflowStepHandler } from '../runtime/engine';
import type { WorkflowManifest, WorkflowRunRecord, WorkflowStoreSnapshot } from '../shared/types';

export interface TestWorkflowInput {
  readonly manifest: WorkflowManifest;
  readonly workflowName: string;
  readonly event?: unknown;
  readonly input?: unknown;
  readonly steps?: Record<string, WorkflowStepHandler>;
}

export interface TestWorkflowResult {
  readonly run: WorkflowRunRecord;
  readonly currentNode?: string | undefined;
  readonly state: Record<string, unknown>;
  readonly snapshot: WorkflowStoreSnapshot;
}

export async function testWorkflow(input: TestWorkflowInput): Promise<TestWorkflowResult> {
  const runtime = createWorkflowRuntime({
    manifest: input.manifest,
    ...(input.steps !== undefined ? { steps: input.steps } : {}),
  });
  const run = await runtime.enqueue(input.workflowName, input.event ?? input.input ?? {});
  const [result] = await runtime.runUntilIdle();
  const current = result ?? run;
  const snapshot = await runtime.snapshot();
  return {
    run: current,
    currentNode: current.currentNode,
    state: current.state,
    snapshot,
  };
}
