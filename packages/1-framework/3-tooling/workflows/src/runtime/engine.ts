import { randomUUID } from 'node:crypto';
import type { ConnectorDefinition } from '../connector-sdk';
import { deepClone, getPath, workflowVersionId } from '../shared/path';
import type {
  WorkflowApprovalIR,
  WorkflowApprovalRecord,
  WorkflowDeadLetterRecord,
  WorkflowDefinitionIR,
  WorkflowExecutionNodeIR,
  WorkflowLeaseRecord,
  WorkflowManifest,
  WorkflowOutboxRecord,
  WorkflowReplayMode,
  WorkflowRunRecord,
  WorkflowStateSnapshotRecord,
  WorkflowStepIR,
  WorkflowStepRunRecord,
  WorkflowTimelineEventRecord,
} from '../shared/types';
import { evaluateWorkflowExpression } from './expression';
import {
  InMemoryWorkflowStore,
  type WorkflowLeaseGuardInput,
  type WorkflowRunRelationsInclude,
  type WorkflowStore,
} from './store';

class WorkflowLeaseLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowLeaseLostError';
  }
}

export interface WorkflowStepContext {
  readonly run: WorkflowRunRecord;
  readonly workflow: WorkflowDefinitionIR;
  readonly step: WorkflowStepIR;
  readonly state: Record<string, unknown>;
  readonly input: unknown;
  outbox(input: {
    readonly destination: string;
    readonly payload: unknown;
    readonly idempotencyKey?: string;
  }): Promise<void>;
}

export type WorkflowStepHandler = (
  context: WorkflowStepContext,
) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;

export interface CreateWorkflowRuntimeOptions {
  readonly manifest: WorkflowManifest;
  readonly store?: WorkflowStore;
  readonly steps?: Record<string, WorkflowStepHandler>;
  readonly workerId?: string;
  readonly leaseTtlMs?: number;
}

const RUN_LEASE_TTL_MS = 30_000;
const TIMER_LEASE_TTL_MS = 30_000;
const OUTBOX_LEASE_TTL_MS = 30_000;
const WORKFLOW_INTERNAL_STATE_KEY = '$prismaWorkflow';
const WORKFLOW_REPLAY_EPOCH_KEY = 'replayEpoch';
const definitionReadyByStore = new WeakMap<WorkflowStore, Map<string, Promise<void>>>();

interface RuntimeLease {
  readonly resourceType: 'run' | 'outbox';
  readonly resourceId: string;
  readonly workerId: string;
  readonly leaseId: string;
  readonly ttlMs: number;
}

interface RunUntilBlockedOptions {
  readonly continueExternalOutbox?: boolean;
  readonly skipStartUpdate?: boolean;
  readonly recoverCompletedSteps?: boolean;
}

interface ApprovalResolutionInput {
  readonly status: Exclude<WorkflowApprovalRecord['status'], 'pending'>;
  readonly resolvedBy: string;
  readonly eventType: string;
  readonly targetKind: ApprovalOutcome;
  readonly payload: unknown;
  readonly decision?: unknown;
  readonly reason?: string;
  readonly terminalMessage?: string;
}

type ApprovalOutcome = 'approve' | 'reject' | 'timeout';
type ApprovalTimelineOutcome = ApprovalOutcome | 'skipped';

interface ApprovalOutcomeRange {
  readonly outcome: ApprovalOutcome;
  readonly startIndex: number;
  readonly endIndex: number;
}

interface WorkflowGraphIndex {
  readonly nodeById: ReadonlyMap<string, WorkflowExecutionNodeIR>;
  readonly nodeIdByName: ReadonlyMap<string, string>;
  readonly nodeIndexById: ReadonlyMap<string, number>;
  readonly nextNodeById: ReadonlyMap<string, string | undefined>;
  readonly hasApprovals: boolean;
}

export interface WorkflowIngestInput {
  readonly source: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly rawPayload?: unknown;
  readonly normalizedPayload?: unknown;
  readonly dedupeKey?: string;
  readonly externalId?: string;
  readonly connectorAccountId?: string;
  readonly headers?: Record<string, string>;
  readonly occurredAt?: Date;
  readonly signatureVerified?: boolean;
}

export interface WorkflowIngestResult {
  readonly eventId: string;
  readonly matchedWorkflows: readonly string[];
  readonly runs: readonly WorkflowRunRecord[];
  readonly duplicate: boolean;
}

export interface WorkflowReplayOptions {
  readonly fromStep?: string;
  readonly mode?: WorkflowReplayMode;
  readonly confirmSideEffects?: boolean;
}

export interface WorkflowRuntime {
  readonly manifest: WorkflowManifest;
  readonly store: WorkflowStore;
  enqueue(workflowName: string, input: unknown): Promise<WorkflowRunRecord>;
  ingest(input: WorkflowIngestInput): Promise<WorkflowIngestResult>;
  runNext(): Promise<WorkflowRunRecord | undefined>;
  runUntilIdle(maxIterations?: number): Promise<readonly WorkflowRunRecord[]>;
  approve(
    approvalId: string,
    input: { readonly approvedBy: string; readonly reason?: string; readonly decision?: unknown },
  ): Promise<WorkflowRunRecord>;
  reject(
    approvalId: string,
    input: { readonly rejectedBy: string; readonly reason?: string; readonly decision?: unknown },
  ): Promise<WorkflowRunRecord>;
  cancel(runId: string, reason?: string): Promise<WorkflowRunRecord>;
  pause(runId: string, reason?: string): Promise<WorkflowRunRecord>;
  resume(runId: string): Promise<WorkflowRunRecord>;
  replay(runId: string, options?: WorkflowReplayOptions): Promise<WorkflowRunRecord>;
  resumeDueTimers(now?: Date): Promise<readonly WorkflowRunRecord[]>;
  expireDueApprovals(now?: Date): Promise<readonly WorkflowRunRecord[]>;
  pendingApprovals(): Promise<readonly WorkflowApprovalRecord[]>;
  dispatchNextOutbox(now?: Date): Promise<WorkflowRunRecord | undefined>;
  inspect(
    runId: string,
    include?: WorkflowRunRelationsInclude,
  ): Promise<WorkflowRunWithInclude | undefined>;
  snapshot(): ReturnType<WorkflowStore['snapshot']>;
}

export interface WorkflowClient {
  enqueue(workflowName: string, input: unknown): Promise<WorkflowRunRecord>;
  ingest(input: WorkflowIngestInput): Promise<WorkflowIngestResult>;
  replay(runId: string, options?: WorkflowReplayOptions): Promise<WorkflowRunRecord>;
  cancel(runId: string, reason?: string): Promise<WorkflowRunRecord>;
  pause(runId: string, reason?: string): Promise<WorkflowRunRecord>;
  resume(runId: string): Promise<WorkflowRunRecord>;
  approve(
    approvalId: string,
    input: { readonly approvedBy: string; readonly reason?: string; readonly decision?: unknown },
  ): Promise<WorkflowRunRecord>;
  reject(
    approvalId: string,
    input: { readonly rejectedBy: string; readonly reason?: string; readonly decision?: unknown },
  ): Promise<WorkflowRunRecord>;
  readonly run: {
    findUnique(input: {
      readonly where: { readonly id: string };
      readonly include?: WorkflowRunInclude;
    }): Promise<WorkflowRunWithInclude | undefined>;
    findMany(): Promise<readonly WorkflowRunRecord[]>;
  };
  readonly step: {
    findMany(input?: {
      readonly where?: { readonly runId?: string };
    }): Promise<readonly WorkflowStepRunRecord[]>;
  };
  readonly deadLetter: {
    findMany(): Promise<readonly unknown[]>;
  };
}

export interface WorkflowRunInclude extends WorkflowRunRelationsInclude {
  readonly steps?: boolean;
  readonly timeline?: boolean;
  readonly stateSnapshots?: boolean;
  readonly approvals?: boolean;
  readonly outbox?: boolean;
  readonly deadLetters?: boolean;
}

export interface WorkflowRunWithInclude extends WorkflowRunRecord {
  readonly steps?: readonly WorkflowStepRunRecord[];
  readonly timeline?: readonly WorkflowTimelineEventRecord[];
  readonly stateSnapshots?: readonly WorkflowStateSnapshotRecord[];
  readonly approvals?: readonly WorkflowApprovalRecord[];
  readonly outbox?: readonly WorkflowOutboxRecord[];
  readonly deadLetters?: readonly WorkflowDeadLetterRecord[];
}

export interface WorkflowHttpApp {
  readonly manifest: WorkflowManifest;
  fetch(request: Request): Promise<Response>;
}

export interface CreateWorkflowHttpAppOptions extends CreateWorkflowRuntimeOptions {
  readonly runtime?: WorkflowRuntime;
  readonly connectors?: Record<string, ConnectorDefinition>;
  readonly secrets?: Record<string, string | undefined>;
}

export function createWorkflowRuntime(options: CreateWorkflowRuntimeOptions): WorkflowRuntime {
  const store = options.store ?? new InMemoryWorkflowStore();
  const steps = options.steps ?? {};
  const workerId = options.workerId ?? `worker_${Math.random().toString(36).slice(2)}`;
  const runLeaseTtlMs = options.leaseTtlMs ?? RUN_LEASE_TTL_MS;
  const workflowByName = new Map(
    options.manifest.workflows.map((workflow) => [workflow.name, workflow]),
  );
  const workflowByVersionId = new Map(
    options.manifest.workflows.map((workflow) => [workflowVersionId(workflow), workflow]),
  );
  const hasTimers = options.manifest.workflows.some((workflow) =>
    workflow.nodes.some((node) => node.kind === 'timer'),
  );
  const hasApprovalTimeouts = options.manifest.workflows.some((workflow) =>
    workflow.nodes.some((node) => node.kind === 'approval' && node.timeout !== undefined),
  );
  const workflowsByTrigger = indexWorkflowsByTrigger(options.manifest.workflows);
  const workflowGraphByVersionId = new Map<string, WorkflowGraphIndex>();
  const releasedRuntimeLeases = new Set<string>();
  const ready = readyForDefinitions(store, options.manifest.workflows);

  async function ensureReady(): Promise<void> {
    await ready;
  }

  function guardFor(lease: RuntimeLease): WorkflowLeaseGuardInput {
    return {
      leaseId: lease.leaseId,
      resourceType: lease.resourceType,
      resourceId: lease.resourceId,
      workerId: lease.workerId,
    };
  }

  async function requireLeased<T>(
    lease: RuntimeLease,
    value: Promise<T | undefined>,
    action: string,
  ): Promise<T> {
    const result = await value;
    if (result === undefined) {
      throw new WorkflowLeaseLostError(
        `Workflow ${lease.resourceType} lease lost for ${lease.resourceId}; skipped ${action}.`,
      );
    }
    return result;
  }

  function isLeaseLost(error: unknown): error is WorkflowLeaseLostError {
    return error instanceof WorkflowLeaseLostError;
  }

  function outboxWaiterOutput(outboxId: string): Record<string, unknown> {
    return { outboxId };
  }

  function outboxReferenceId(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = Object.entries(value).find(([key]) => key === 'outboxId')?.[1];
    return typeof candidate === 'string' ? candidate : undefined;
  }

  async function enqueue(workflowName: string, input: unknown): Promise<WorkflowRunRecord> {
    await ensureReady();
    const workflow = await requireWorkflow(workflowName);
    return store.createRunWithTimeline({
      run: {
        workflowId: workflow.id,
        versionId: workflowVersionId(workflow),
        status: 'queued',
        currentNode: workflow.nodes[0]?.id,
        input,
        state: seedState(input),
      },
      event: {
        runId: '',
        type: 'RUN_QUEUED',
        payload: { workflowName },
      },
    });
  }

  async function ingest(input: WorkflowIngestInput): Promise<WorkflowIngestResult> {
    await ensureReady();
    const indexedMatches = workflowsByTrigger.get(triggerKey(input.source, input.eventType));
    const matches =
      indexedMatches ?? (await store.findWorkflowByTrigger(input.source, input.eventType));
    const dedupeKey = dedupeKeyForMatches(matches, input);
    const result = await store.ingestEventAndCreateRuns({
      event: {
        source: input.source,
        ...(input.connectorAccountId !== undefined
          ? { connectorAccountId: input.connectorAccountId }
          : {}),
        eventType: input.eventType,
        externalId: input.externalId ?? String(getPath(input.payload, 'id') ?? dedupeKey),
        dedupeKey,
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
        ...(input.headers !== undefined ? { headers: input.headers } : {}),
        rawPayload: input.rawPayload ?? input.payload,
        normalizedPayload: input.normalizedPayload ?? input.payload,
        signatureVerified: input.signatureVerified ?? false,
        status: matches.length > 0 ? 'matched' : 'ignored',
      },
      runs: matches.map((workflow) => ({
        workflowId: workflow.id,
        versionId: workflowVersionId(workflow),
        status: 'queued',
        currentNode: workflow.nodes[0]?.id,
        input: input.payload,
        state: seedState(input.payload),
      })),
    });
    if (result.timelinesCreated !== true) {
      await store.appendTimelineBatch(
        result.runs.map((run) => ({
          runId: run.id,
          type: 'INGEST_MATCHED',
          payload: { eventId: result.event.id, source: input.source, eventType: input.eventType },
        })),
      );
    }
    return {
      eventId: result.event.id,
      matchedWorkflows: matches.map((w) => w.name),
      runs: result.runs,
      duplicate: result.duplicate,
    };
  }

  function leaseOwner(): string {
    return `${workerId}:${randomUUID()}`;
  }

  function runtimeLeaseFromRecord(lease: WorkflowLeaseRecord, ttlMs: number): RuntimeLease {
    if (lease.resourceType !== 'run' && lease.resourceType !== 'outbox') {
      throw new Error(`Unsupported runtime lease resource: ${lease.resourceType}`);
    }
    return {
      resourceType: lease.resourceType,
      resourceId: lease.resourceId,
      workerId: lease.workerId,
      leaseId: lease.id,
      ttlMs,
    };
  }

  function releaseRuntimeLease(lease: RuntimeLease): Promise<void> {
    if (releasedRuntimeLeases.delete(runtimeLeaseKey(lease))) {
      return Promise.resolve();
    }
    return store.releaseLease(lease.resourceType, lease.resourceId, lease.workerId, lease.leaseId);
  }

  function markRuntimeLeaseReleased(lease: RuntimeLease): void {
    releasedRuntimeLeases.add(runtimeLeaseKey(lease));
  }

  function runtimeLeaseKey(lease: RuntimeLease): string {
    return `${lease.resourceType}:${lease.resourceId}:${lease.workerId}:${lease.leaseId}`;
  }

  async function claimRunWithLease(
    runId: string,
    now?: Date,
    statuses?: readonly WorkflowRunRecord['status'][],
  ): Promise<{ readonly run: WorkflowRunRecord; readonly lease: RuntimeLease } | undefined> {
    const owner = leaseOwner();
    const claimed = await store.claimRunWithLease({
      runId,
      workerId: owner,
      ttlMs: runLeaseTtlMs,
      ...(now !== undefined ? { now } : {}),
      ...(statuses !== undefined ? { statuses } : {}),
    });
    if (!claimed) return undefined;
    return {
      run: claimed.run,
      lease: runtimeLeaseFromRecord(claimed.lease, runLeaseTtlMs),
    };
  }

  async function claimApprovalRunWithLease(approvalId: string): Promise<
    | {
        readonly approval: WorkflowApprovalRecord;
        readonly run: WorkflowRunRecord;
        readonly lease: RuntimeLease;
      }
    | undefined
  > {
    const owner = leaseOwner();
    const claimed = await store.claimApprovalRunWithLease({
      approvalId,
      workerId: owner,
      ttlMs: runLeaseTtlMs,
    });
    if (!claimed) return undefined;
    return {
      approval: claimed.approval,
      run: claimed.run,
      lease: runtimeLeaseFromRecord(claimed.lease, runLeaseTtlMs),
    };
  }

  async function claimNextRunWithLease(): Promise<
    { readonly run: WorkflowRunRecord; readonly lease: RuntimeLease } | undefined
  > {
    const owner = leaseOwner();
    const claimed = await store.claimNextRunWithLease({
      workerId: owner,
      ttlMs: runLeaseTtlMs,
    });
    if (!claimed) return undefined;
    return {
      run: claimed.run,
      lease: runtimeLeaseFromRecord(claimed.lease, runLeaseTtlMs),
    };
  }

  async function claimNextOutboxWithLease(
    now: Date,
  ): Promise<{ readonly outbox: WorkflowOutboxRecord; readonly lease: RuntimeLease } | undefined> {
    const owner = leaseOwner();
    const claimed = await store.claimNextOutboxWithLease({
      workerId: owner,
      ttlMs: OUTBOX_LEASE_TTL_MS,
      now,
    });
    if (!claimed) return undefined;
    return {
      outbox: claimed.outbox,
      lease: runtimeLeaseFromRecord(claimed.lease, OUTBOX_LEASE_TTL_MS),
    };
  }

  async function claimNextOutboxAndRunWithLeases(now: Date): Promise<
    | {
        readonly outbox: WorkflowOutboxRecord;
        readonly outboxLease: RuntimeLease;
        readonly run: WorkflowRunRecord;
        readonly runLease: RuntimeLease;
        readonly stepRun?: WorkflowStepRunRecord;
      }
    | undefined
  > {
    const owner = leaseOwner();
    const claimed = await store.claimNextOutboxAndRunWithLeases?.({
      workerId: owner,
      ttlMs: OUTBOX_LEASE_TTL_MS,
      runTtlMs: runLeaseTtlMs,
      now,
    });
    if (!claimed) return undefined;
    return {
      outbox: claimed.outbox,
      outboxLease: runtimeLeaseFromRecord(claimed.outboxLease, OUTBOX_LEASE_TTL_MS),
      run: claimed.run,
      runLease: runtimeLeaseFromRecord(claimed.runLease, runLeaseTtlMs),
      ...(claimed.stepRun !== undefined ? { stepRun: claimed.stepRun } : {}),
    };
  }

  async function runNext(): Promise<WorkflowRunRecord | undefined> {
    await ensureReady();
    await resumeDueTimers();
    await expireDueApprovals();
    const claimed = await claimNextRunWithLease();
    if (claimed) return runClaimedRun(claimed.run, claimed.lease);

    await reconcileWaitingRuns();
    await reconcileOutboxWaiters();
    await reconcilePausedSteps();
    const reconciled = await claimNextRunWithLease();
    if (!reconciled) return undefined;
    return runClaimedRun(reconciled.run, reconciled.lease);
  }

  async function runUntilIdle(maxIterations = 100): Promise<readonly WorkflowRunRecord[]> {
    await ensureReady();
    const completed: WorkflowRunRecord[] = [];
    let preferOutboxDispatch = false;
    for (let i = 0; i < maxIterations; i += 1) {
      if (hasTimers) await resumeDueTimers();
      if (hasApprovalTimeouts) await expireDueApprovals();
      let run: WorkflowRunRecord | undefined;
      if (preferOutboxDispatch) {
        run = await dispatchNextOutbox(new Date(), { continueRun: true });
        preferOutboxDispatch = false;
      }
      if (!run) {
        const claimed = await claimNextRunWithLease();
        if (claimed) {
          run = await runClaimedRun(claimed.run, claimed.lease, {
            continueExternalOutbox: true,
          });
        } else {
          run = await dispatchNextOutbox(new Date(), { continueRun: true });
        }
      }
      if (!run) {
        await reconcileWaitingRuns();
        await reconcileOutboxWaiters();
        await reconcilePausedSteps();
        const reconciled = await claimNextRunWithLease();
        if (reconciled) {
          run = await runClaimedRun(reconciled.run, reconciled.lease, {
            continueExternalOutbox: true,
          });
        }
      }
      if (!run) break;
      preferOutboxDispatch = run.status === 'paused';
      completed.push(run);
    }
    return completed;
  }

  async function approve(
    approvalId: string,
    input: { readonly approvedBy: string; readonly reason?: string; readonly decision?: unknown },
  ): Promise<WorkflowRunRecord> {
    await ensureReady();
    const claimedApproval = await claimApprovalRunWithLease(approvalId);
    const approval = claimedApproval?.approval ?? (await store.findApproval(approvalId));
    if (!approval) throw new Error(`Workflow approval not found: ${approvalId}`);
    if (!claimedApproval && approval.status !== 'pending') return requireRun(approval.runId);
    const claimed = claimedApproval ?? (await claimRunWithLease(approval.runId));
    if (!claimed) return requireRun(approval.runId);
    let executed: WorkflowRunRecord;
    try {
      executed = await resolveClaimedApproval(claimed.run, claimed.lease, approval, {
        status: 'approved',
        resolvedBy: input.approvedBy,
        eventType: 'APPROVAL_APPROVED',
        targetKind: 'approve',
        payload: input,
        ...(input.decision !== undefined ? { decision: input.decision } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      });
    } finally {
      await releaseRuntimeLease(claimed.lease);
    }
    if (executed.status !== 'paused') return executed;
    const drained = await runUntilIdle();
    return [...drained].reverse().find((candidate) => candidate.id === approval.runId) ?? executed;
  }

  async function reject(
    approvalId: string,
    input: { readonly rejectedBy: string; readonly reason?: string; readonly decision?: unknown },
  ): Promise<WorkflowRunRecord> {
    await ensureReady();
    const claimedApproval = await claimApprovalRunWithLease(approvalId);
    const approval = claimedApproval?.approval ?? (await store.findApproval(approvalId));
    if (!approval) throw new Error(`Workflow approval not found: ${approvalId}`);
    if (!claimedApproval && approval.status !== 'pending') return requireRun(approval.runId);
    const claimed = claimedApproval ?? (await claimRunWithLease(approval.runId));
    if (!claimed) return requireRun(approval.runId);
    try {
      return await resolveClaimedApproval(claimed.run, claimed.lease, approval, {
        status: 'rejected',
        resolvedBy: input.rejectedBy,
        eventType: 'APPROVAL_REJECTED',
        targetKind: 'reject',
        payload: input,
        terminalMessage: input.reason ?? 'Approval rejected',
        ...(input.decision !== undefined ? { decision: input.decision } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      });
    } finally {
      await releaseRuntimeLease(claimed.lease);
    }
  }

  async function resolveClaimedApproval(
    run: WorkflowRunRecord,
    lease: RuntimeLease,
    approval: WorkflowApprovalRecord,
    input: ApprovalResolutionInput,
  ): Promise<WorkflowRunRecord> {
    if (run.status !== 'waiting_for_approval' || run.currentNode !== approval.nodeId) {
      return run;
    }
    if (!approvalMatchesRunReplayEpoch(run, approval)) {
      return run;
    }
    const workflow = await workflowForRun(run);
    const candidateApprovalNode = graphForWorkflow(workflow).nodeById.get(approval.nodeId);
    const approvalNode =
      candidateApprovalNode?.kind === 'approval' ? candidateApprovalNode : undefined;
    if (!approvalNode) {
      return await requireLeased(
        lease,
        store.updateRunIfLeased({
          guard: guardFor(lease),
          runId: run.id,
          patch: {
            status: 'failed',
            error: { message: `Workflow approval node not found: ${approval.nodeId}` },
            completedAt: new Date(),
          },
        }),
        'approval missing-node failure',
      );
    }
    try {
      assertApprovalBranchLayout(workflow, approvalNode, input.targetKind);
    } catch (error) {
      return failApprovalBranchLayout(run, approval.nodeId, lease, error);
    }
    const target =
      input.targetKind === 'approve'
        ? targetNodeId(workflow, approvalNode.onApprove)
        : input.targetKind === 'reject'
          ? targetNodeId(workflow, approvalNode.onReject)
          : targetNodeId(workflow, approvalNode.onTimeout);
    const continuationTarget =
      target ??
      (input.targetKind === 'approve' ? await nextNodeId(run, approval.nodeId) : undefined);
    const approvalResolution = {
      guard: guardFor(lease),
      approvalId: approval.id,
      runId: run.id,
      nodeId: approval.nodeId,
      status: input.status,
      resolvedBy: input.resolvedBy,
      ...(input.decision !== undefined ? { decision: input.decision } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      event: {
        runId: run.id,
        nodeId: approval.nodeId,
        type: input.eventType,
        payload: input.payload,
      },
    };
    if (continuationTarget) {
      const queued = await requireLeased(
        lease,
        store.resolveApprovalAndUpdateRunIfLeased({
          ...approvalResolution,
          runPatch: { status: 'queued', currentNode: continuationTarget },
        }),
        'approval continuation queue',
      );
      return runUntilBlocked(queued, lease, {
        skipStartUpdate: true,
        recoverCompletedSteps: false,
      });
    }
    return requireLeased(
      lease,
      store.resolveApprovalAndUpdateRunIfLeased({
        ...approvalResolution,
        runPatch: {
          status: 'failed',
          currentNode: approval.nodeId,
          error: { message: input.terminalMessage ?? 'Approval did not continue' },
          completedAt: new Date(),
        },
      }),
      'approval terminal failure',
    );
  }

  async function cancel(runId: string, reason?: string): Promise<WorkflowRunRecord> {
    await ensureReady();
    const run = await requireRun(runId);
    if (isTerminalRunStatus(run.status)) {
      throw new Error(`Refusing to cancel ${run.status} workflow run ${run.id}.`);
    }
    const claimed = await claimRunWithLease(runId);
    if (!claimed)
      throw new Error(`Workflow run ${runId} is currently leased and cannot be cancelled.`);
    try {
      await requireLeased(
        claimed.lease,
        store.appendTimelineIfLeased({
          guard: guardFor(claimed.lease),
          event: { runId, type: 'RUN_CANCELLED', payload: { reason } },
        }),
        'cancel timeline append',
      );
      return await requireLeased(
        claimed.lease,
        store.updateRunIfLeased({
          guard: guardFor(claimed.lease),
          runId: claimed.run.id,
          patch: {
            status: 'cancelled',
            error: reason ? { message: reason } : undefined,
            completedAt: new Date(),
          },
        }),
        'cancel run update',
      );
    } finally {
      await releaseRuntimeLease(claimed.lease);
    }
  }

  async function pause(runId: string, reason?: string): Promise<WorkflowRunRecord> {
    await ensureReady();
    const run = await requireRun(runId);
    if (isTerminalRunStatus(run.status)) {
      throw new Error(`Refusing to pause ${run.status} workflow run ${run.id}.`);
    }
    const claimed = await claimRunWithLease(runId);
    if (!claimed)
      throw new Error(`Workflow run ${runId} is currently leased and cannot be paused.`);
    try {
      await requireLeased(
        claimed.lease,
        store.appendTimelineIfLeased({
          guard: guardFor(claimed.lease),
          event: { runId, type: 'RUN_PAUSED', payload: { reason } },
        }),
        'pause timeline append',
      );
      return await requireLeased(
        claimed.lease,
        store.updateRunIfLeased({
          guard: guardFor(claimed.lease),
          runId: claimed.run.id,
          patch: { status: 'paused' },
        }),
        'pause run update',
      );
    } finally {
      await releaseRuntimeLease(claimed.lease);
    }
  }

  async function resume(runId: string): Promise<WorkflowRunRecord> {
    await ensureReady();
    const run = await requireRun(runId);
    if (isTerminalRunStatus(run.status)) {
      throw new Error(
        `Refusing to resume ${run.status} workflow run ${run.id}. Use replay({ mode: "fork" }) to create a new run.`,
      );
    }
    const claimed = await claimRunWithLease(runId);
    if (!claimed)
      throw new Error(`Workflow run ${runId} is currently leased and cannot be resumed.`);
    if (isTerminalRunStatus(claimed.run.status)) {
      await releaseRuntimeLease(claimed.lease);
      throw new Error(
        `Refusing to resume ${claimed.run.status} workflow run ${claimed.run.id}. Use replay({ mode: "fork" }) to create a new run.`,
      );
    }
    try {
      if (await isPausedForOutbox(claimed.run)) {
        throw new Error(
          `Workflow run ${runId} is waiting for external outbox dispatch and cannot be resumed manually.`,
        );
      }
      await requireLeased(
        claimed.lease,
        store.appendTimelineIfLeased({
          guard: guardFor(claimed.lease),
          event: { runId, type: 'RUN_RESUMED' },
        }),
        'resume timeline append',
      );
      return await requireLeased(
        claimed.lease,
        store.updateRunIfLeased({
          guard: guardFor(claimed.lease),
          runId: claimed.run.id,
          patch: { status: 'queued' },
        }),
        'resume run update',
      );
    } finally {
      await releaseRuntimeLease(claimed.lease);
    }
  }

  async function isPausedForOutbox(run: WorkflowRunRecord): Promise<boolean> {
    if (run.status !== 'paused' || run.currentNode === undefined) return false;
    const inspection = await store.inspectRun({
      runId: run.id,
      include: { steps: true, outbox: true },
    });
    const pendingOutbox = (inspection?.outbox ?? []).some(
      (outbox) => outbox.nodeId === run.currentNode && outbox.status === 'pending',
    );
    if (pendingOutbox) return true;
    return (inspection?.steps ?? []).some(
      (step) =>
        step.nodeId === run.currentNode &&
        step.status === 'queued' &&
        outboxReferenceId(step.output) !== undefined,
    );
  }

  async function replay(
    runId: string,
    options: WorkflowReplayOptions = {},
  ): Promise<WorkflowRunRecord> {
    await ensureReady();
    const original = await requireRun(runId);
    const workflow = await workflowForRun(original);
    const mode = options.mode ?? 'fork';
    const fromNode =
      options.fromStep !== undefined
        ? workflow.nodes.find(
            (node) => node.name === options.fromStep || node.id === options.fromStep,
          )
        : workflow.nodes[0];
    if (options.fromStep !== undefined && fromNode === undefined) {
      throw new Error(
        `Workflow replay step not found: ${options.fromStep}. Valid steps: ${workflow.nodes.map((node) => node.name).join(', ')}`,
      );
    }
    const replayState = await replayStateForNode(original, fromNode?.id);
    if (mode !== 'recorded') {
      const unsafeExternalNodes = unsafeExternalNodesFrom(workflow, fromNode?.id, replayState);
      if (unsafeExternalNodes.length > 0 && !options.confirmSideEffects) {
        throw new Error(
          `Refusing to replay external side effects for ${unsafeExternalNodes.map((node) => node.name).join(', ')} without confirmation or idempotency.`,
        );
      }
    }
    if (mode === 'recorded') {
      return store.createRunWithTimelineAndSnapshot({
        run: {
          workflowId: original.workflowId,
          versionId: original.versionId,
          ...(original.ingestEventId !== undefined
            ? { ingestEventId: original.ingestEventId }
            : {}),
          status: 'completed',
          currentNode: undefined,
          input: original.input,
          output: replayState,
          state: replayState,
          startedAt: new Date(),
          completedAt: new Date(),
        },
        event: {
          runId: '',
          type: 'RUN_REPLAYED_RECORDED',
          payload: { originalRunId: runId, fromStep: options.fromStep, mode },
        },
        snapshot: {
          runId: '',
          ...(fromNode?.id !== undefined ? { nodeId: fromNode.id } : {}),
          state: replayState,
        },
      });
    }
    if (mode === 'resume') {
      if (original.status === 'completed' || original.status === 'cancelled') {
        throw new Error(
          `Refusing to resume ${original.status} workflow run ${original.id}. Use fork or recorded replay instead.`,
        );
      }
      const claimed = await claimRunWithLease(original.id, undefined, [
        'queued',
        'running',
        'paused',
        'waiting_for_approval',
        'waiting_for_timer',
        'failed',
      ]);
      if (!claimed) {
        throw new Error(`Workflow run ${original.id} is currently leased and cannot be replayed.`);
      }
      try {
        if (claimed.run.status === 'completed' || claimed.run.status === 'cancelled') {
          throw new Error(
            `Refusing to resume ${claimed.run.status} workflow run ${claimed.run.id}. Use fork or recorded replay instead.`,
          );
        }
        if (await isPausedForOutbox(claimed.run)) {
          throw new Error(
            `Workflow run ${original.id} is waiting for external outbox dispatch and cannot be replay-resumed manually.`,
          );
        }
        const replayEpoch = randomUUID();
        const resumedState = stateWithNewReplayEpoch(replayState, replayEpoch);
        await appendReplayBranchOutcomeIfLeased({
          runId: original.id,
          workflow,
          fromNodeId: fromNode?.id,
          originalRunId: runId,
          mode,
          replayMarkerId: replayEpoch,
          lease: claimed.lease,
        });
        await requireLeased(
          claimed.lease,
          store.appendTimelineIfLeased({
            guard: guardFor(claimed.lease),
            event: {
              runId: original.id,
              type: 'RUN_REPLAY_RESUMED',
              payload: {
                fromStep: options.fromStep,
                mode,
                replayEpoch,
                replayMarkerId: replayEpoch,
              },
            },
          }),
          'replay resume timeline append',
        );
        await store.supersedeReplayWaitsIfLeased({
          guard: guardFor(claimed.lease),
          runId: original.id,
        });
        return await requireLeased(
          claimed.lease,
          store.updateRunIfLeased({
            guard: guardFor(claimed.lease),
            runId: original.id,
            patch: {
              status: 'queued',
              currentNode: fromNode?.id ?? original.currentNode,
              state: resumedState,
            },
          }),
          'replay resume run update',
        );
      } finally {
        await releaseRuntimeLease(claimed.lease);
      }
    }
    const replayed = await store.createRun({
      workflowId: original.workflowId,
      versionId: original.versionId,
      ...(original.ingestEventId !== undefined ? { ingestEventId: original.ingestEventId } : {}),
      status: 'paused',
      currentNode: undefined,
      input: original.input,
      state: replayState,
    });
    const replayMarkerId = randomUUID();
    await store.appendTimeline({
      runId: replayed.id,
      type: 'RUN_REPLAYED',
      payload: { originalRunId: runId, fromStep: options.fromStep, mode, replayMarkerId },
    });
    await appendReplayBranchOutcome({
      runId: replayed.id,
      workflow,
      fromNodeId: fromNode?.id,
      originalRunId: runId,
      mode,
      replayMarkerId,
    });
    return store.updateRun(replayed.id, { status: 'queued', currentNode: fromNode?.id });
  }

  async function reconcileWaitingRuns(): Promise<void> {
    const snapshot = await store.snapshot();
    for (const run of snapshot.runs) {
      if (run.status === 'waiting_for_timer') {
        const timer = snapshot.timers.find(
          (candidate) =>
            candidate.runId === run.id &&
            candidate.nodeId === run.currentNode &&
            candidate.status === 'completed' &&
            timerMatchesRunReplayEpoch(run, candidate),
        );
        if (timer) {
          await reconcileCompletedTimer(run.id, timer);
        }
      }
      if (run.status === 'waiting_for_approval') {
        const approval = snapshot.approvals.find(
          (candidate) =>
            candidate.runId === run.id &&
            candidate.nodeId === run.currentNode &&
            candidate.status !== 'pending' &&
            approvalMatchesRunReplayEpoch(run, candidate),
        );
        if (approval) {
          await reconcileResolvedApproval(run.id, approval);
        }
      }
    }
  }

  async function reconcileOutboxWaiters(): Promise<void> {
    const snapshot = await store.snapshot();
    const outboxById = new Map(snapshot.outbox.map((outbox) => [outbox.id, outbox]));
    const reconciled = new Set<string>();
    for (const step of snapshot.steps) {
      if (step.status !== 'queued') continue;
      const waiterRun = snapshot.runs.find((run) => run.id === step.runId);
      if (!waiterRun || !stepMatchesRunReplayEpoch(waiterRun, step)) continue;
      const outboxId = outboxReferenceId(step.output);
      if (!outboxId || reconciled.has(outboxId)) continue;
      const outbox = outboxById.get(outboxId);
      if (!outbox || outbox.status === 'pending') continue;
      reconciled.add(outboxId);
      if (outbox.status === 'dispatched') {
        const payload = recordFromUnknown(outbox.payload);
        await resumeOutboxWaiters(outbox, recordFromUnknown(payload['output']));
      } else {
        await failOutboxWaiters(
          outbox,
          outboxErrorMessage(outbox) ?? 'External outbox failed before waiter resumed',
        );
      }
    }
  }

  async function reconcileCompletedTimer(
    runId: string,
    timer: { readonly nodeId: string; readonly payload?: unknown },
  ): Promise<void> {
    const claimed = await claimRunWithLease(runId);
    if (
      !claimed ||
      claimed.run.status !== 'waiting_for_timer' ||
      claimed.run.currentNode !== timer.nodeId ||
      !timerMatchesRunReplayEpoch(claimed.run, timer)
    ) {
      if (claimed) await releaseRuntimeLease(claimed.lease);
      return;
    }
    try {
      await requireLeased(
        claimed.lease,
        store.updateRunIfLeased({
          guard: guardFor(claimed.lease),
          runId: claimed.run.id,
          patch: {
            status: 'queued',
            currentNode: await nextNodeId(claimed.run, timer.nodeId),
          },
        }),
        'completed timer reconciliation run update',
      );
    } finally {
      await releaseRuntimeLease(claimed.lease);
    }
  }

  async function reconcileResolvedApproval(
    runId: string,
    approval: WorkflowApprovalRecord,
  ): Promise<void> {
    const claimed = await claimRunWithLease(runId);
    if (!claimed) return;
    try {
      if (
        claimed.run.status !== 'waiting_for_approval' ||
        claimed.run.currentNode !== approval.nodeId ||
        !approvalMatchesRunReplayEpoch(claimed.run, approval)
      ) {
        return;
      }
      const workflow = await workflowForRun(claimed.run);
      const approvalNode = workflow.nodes.find(
        (node): node is WorkflowApprovalIR =>
          node.kind === 'approval' && node.id === approval.nodeId,
      );
      if (!approvalNode) return;
      const outcome = approvalOutcomeForStatus(approval.status);
      if (!outcome) return;
      try {
        assertApprovalBranchLayout(workflow, approvalNode, outcome);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await requireLeased(
          claimed.lease,
          store.updateRunIfLeased({
            guard: guardFor(claimed.lease),
            runId: claimed.run.id,
            patch: {
              status: 'failed',
              currentNode: approval.nodeId,
              error: { message },
              completedAt: new Date(),
            },
          }),
          'resolved approval branch-layout failure',
        );
        return;
      }
      await appendMissingApprovalOutcomeTimeline(claimed.run, approval, claimed.lease);
      const target =
        outcome === 'approve'
          ? targetNodeId(workflow, approvalNode.onApprove)
          : outcome === 'reject'
            ? targetNodeId(workflow, approvalNode.onReject)
            : targetNodeId(workflow, approvalNode.onTimeout);
      if (target) {
        await requireLeased(
          claimed.lease,
          store.updateRunIfLeased({
            guard: guardFor(claimed.lease),
            runId: claimed.run.id,
            patch: { status: 'queued', currentNode: target },
          }),
          'resolved approval reconciliation queue',
        );
        return;
      }
      if (outcome === 'approve') {
        await requireLeased(
          claimed.lease,
          store.updateRunIfLeased({
            guard: guardFor(claimed.lease),
            runId: claimed.run.id,
            patch: {
              status: 'queued',
              currentNode: await nextNodeId(claimed.run, approval.nodeId),
            },
          }),
          'resolved approval reconciliation default queue',
        );
        return;
      }
      await requireLeased(
        claimed.lease,
        store.updateRunIfLeased({
          guard: guardFor(claimed.lease),
          runId: claimed.run.id,
          patch: {
            status: 'failed',
            currentNode: approval.nodeId,
            error: {
              message:
                approval.status === 'expired'
                  ? 'Approval timed out without a continuation'
                  : 'Approval rejected without a continuation',
            },
            completedAt: new Date(),
          },
        }),
        'resolved approval reconciliation terminal failure',
      );
    } finally {
      await releaseRuntimeLease(claimed.lease);
    }
  }

  function approvalOutcomeForStatus(
    status: WorkflowApprovalRecord['status'],
  ): 'approve' | 'reject' | 'timeout' | undefined {
    switch (status) {
      case 'approved':
        return 'approve';
      case 'rejected':
        return 'reject';
      case 'expired':
        return 'timeout';
      case 'pending':
        return undefined;
    }
  }

  async function appendMissingApprovalOutcomeTimeline(
    run: WorkflowRunRecord,
    approval: WorkflowApprovalRecord,
    lease: RuntimeLease,
  ): Promise<void> {
    const eventType = approvalTimelineEventType(approval.status);
    if (!eventType) return;
    const inspection = await store.inspectRun({ runId: run.id, include: { timeline: true } });
    const latestReplayResume = [...(inspection?.timeline ?? [])]
      .reverse()
      .find((event) => event.type === 'RUN_REPLAY_RESUMED');
    const alreadyRecorded = (inspection?.timeline ?? []).some(
      (event) =>
        event.nodeId === approval.nodeId &&
        event.type === eventType &&
        (latestReplayResume === undefined || event.sequence > latestReplayResume.sequence),
    );
    if (alreadyRecorded) return;
    await requireLeased(
      lease,
      store.appendTimelineIfLeased({
        guard: guardFor(lease),
        event: {
          runId: run.id,
          nodeId: approval.nodeId,
          type: eventType,
          payload: {
            approvalId: approval.id,
            resolvedBy: approval.resolvedBy,
            ...(approval.decision !== undefined ? { decision: approval.decision } : {}),
            ...(approval.reason !== undefined ? { reason: approval.reason } : {}),
          },
        },
      }),
      'resolved approval reconciliation timeline append',
    );
  }

  function approvalTimelineEventType(status: WorkflowApprovalRecord['status']): string | undefined {
    switch (status) {
      case 'approved':
        return 'APPROVAL_APPROVED';
      case 'rejected':
        return 'APPROVAL_REJECTED';
      case 'expired':
        return 'APPROVAL_TIMED_OUT';
      case 'pending':
        return undefined;
    }
  }

  async function pendingApprovalForCurrentEpoch(
    runId: string,
    nodeId: string,
  ): Promise<WorkflowApprovalRecord | undefined> {
    const inspection = await store.inspectRun({ runId, include: { approvals: true } });
    if (!inspection) return undefined;
    return (inspection.approvals ?? [])
      .filter(
        (approval) =>
          approval.nodeId === nodeId &&
          approval.status === 'pending' &&
          approvalMatchesRunReplayEpoch(inspection.run, approval),
      )
      .sort((left, right) => right.requestedAt.valueOf() - left.requestedAt.valueOf())[0];
  }

  async function resumeDueTimers(now = new Date()): Promise<readonly WorkflowRunRecord[]> {
    await ensureReady();
    const resumed: WorkflowRunRecord[] = [];
    for (const timer of await store.readyTimers(now)) {
      const timerLeaseRecord = await store.acquireLease({
        resourceType: 'timer',
        resourceId: timer.id,
        workerId: leaseOwner(),
        ttlMs: TIMER_LEASE_TTL_MS,
        now,
      });
      if (!timerLeaseRecord) continue;
      const timerLease = {
        leaseId: timerLeaseRecord.id,
        resourceType: 'timer',
        resourceId: timer.id,
        workerId: timerLeaseRecord.workerId,
        ttlMs: TIMER_LEASE_TTL_MS,
      } satisfies WorkflowLeaseGuardInput & { readonly ttlMs: number };
      let runLease: RuntimeLease | undefined;
      try {
        const claimed = await claimRunWithLease(timer.runId);
        if (!claimed) continue;
        const { run } = claimed;
        runLease = claimed.lease;
        if (
          run.status !== 'waiting_for_timer' ||
          run.currentNode !== timer.nodeId ||
          !timerMatchesRunReplayEpoch(run, timer)
        ) {
          continue;
        }
        await requireLeased(
          runLease,
          store.updateTimerIfLeased({
            guard: timerLease,
            timerId: timer.id,
            patch: { status: 'completed' },
          }),
          'timer completion',
        );
        const next = await requireLeased(
          runLease,
          store.updateRunIfLeased({
            guard: guardFor(runLease),
            runId: run.id,
            patch: {
              status: 'queued',
              currentNode: await nextNodeId(run, timer.nodeId),
            },
          }),
          'timer run resume',
        );
        await requireLeased(
          runLease,
          store.appendTimelineIfLeased({
            guard: guardFor(runLease),
            event: {
              runId: run.id,
              nodeId: timer.nodeId,
              type: 'TIMER_RESUMED',
              payload: { timerId: timer.id },
            },
          }),
          'timer resume timeline append',
        );
        resumed.push(next);
      } catch (error) {
        if (!isLeaseLost(error)) throw error;
      } finally {
        await store.releaseLease('timer', timer.id, timerLease.workerId, timerLease.leaseId);
        if (runLease) {
          await releaseRuntimeLease(runLease);
        }
      }
    }
    return resumed;
  }

  async function expireDueApprovals(now = new Date()): Promise<readonly WorkflowRunRecord[]> {
    await ensureReady();
    const expiredRuns: WorkflowRunRecord[] = [];
    for (const approval of await store.readyApprovals(now)) {
      const claimed = await claimRunWithLease(approval.runId);
      if (!claimed) continue;
      try {
        if (
          claimed.run.status !== 'waiting_for_approval' ||
          claimed.run.currentNode !== approval.nodeId ||
          !approvalMatchesRunReplayEpoch(claimed.run, approval)
        ) {
          continue;
        }
        const next = await resolveClaimedApproval(claimed.run, claimed.lease, approval, {
          status: 'expired',
          resolvedBy: 'system:workflow-timeout',
          eventType: 'APPROVAL_TIMED_OUT',
          targetKind: 'timeout',
          payload: { approvalId: approval.id, expiresAt: approval.expiresAt?.toISOString() },
          terminalMessage: 'Approval timed out',
        });
        expiredRuns.push(next);
      } catch (error) {
        if (!isLeaseLost(error)) throw error;
      } finally {
        await releaseRuntimeLease(claimed.lease);
      }
    }
    return expiredRuns;
  }

  async function runClaimedRun(
    initialRun: WorkflowRunRecord,
    lease: RuntimeLease,
    options: RunUntilBlockedOptions = {},
  ): Promise<WorkflowRunRecord> {
    try {
      return await runUntilBlocked(initialRun, lease, options);
    } catch (error) {
      if (!isLeaseLost(error)) throw error;
      return (await store.findRun(initialRun.id)) ?? initialRun;
    } finally {
      await releaseRuntimeLease(lease);
    }
  }

  async function runUntilBlocked(
    initialRun: WorkflowRunRecord,
    lease: RuntimeLease,
    options: RunUntilBlockedOptions = {},
  ): Promise<WorkflowRunRecord> {
    const recoverCompletedSteps = options.recoverCompletedSteps ?? initialRun.status === 'running';
    const freshRun = initialRun.status === 'queued' && initialRun.startedAt === undefined;
    const workflow = await workflowForRun(initialRun);
    const graph = graphForWorkflow(workflow);
    const initialNode =
      initialRun.currentNode === undefined ? undefined : graph.nodeById.get(initialRun.currentNode);
    const deferStartToFirstStep =
      freshRun &&
      initialNode?.kind === 'step' &&
      canStartStepWithoutHistory(initialRun, initialNode, recoverCompletedSteps);
    let run: WorkflowRunRecord;
    if (options.skipStartUpdate) {
      run = initialRun;
    } else if (deferStartToFirstStep) {
      run = { ...initialRun, status: 'running', startedAt: new Date() };
    } else {
      run = await requireLeased(
        lease,
        store.updateRunIfLeased({
          guard: guardFor(lease),
          runId: initialRun.id,
          patch: {
            status: 'running',
            startedAt: initialRun.startedAt ?? new Date(),
          },
        }),
        'run start',
      );
    }
    let advancedWithinLease = false;
    for (;;) {
      const node = run.currentNode === undefined ? undefined : graph.nodeById.get(run.currentNode);
      if (!node) {
        const completed = await requireLeased(
          lease,
          store.appendTimelineAndUpdateRunIfLeased({
            guard: guardFor(lease),
            runId: run.id,
            event: { runId: run.id, type: 'RUN_COMPLETED', payload: run.state },
            patch: {
              status: 'completed',
              completedAt: new Date(),
              output: run.state,
              currentNode: undefined,
            },
            releaseRunLease: true,
          }),
          'run completion update',
        );
        markRuntimeLeaseReleased(lease);
        return completed;
      }
      if (node.kind === 'approval') {
        if (!evaluateWorkflowExpression(node.when, run.state)) {
          run = await skipApproval(run, node, workflow, lease);
          if (run.status !== 'running') return run;
          advancedWithinLease = true;
          continue;
        }
        const existing = canCreateApprovalWithoutHistory(
          run,
          recoverCompletedSteps,
          freshRun,
          advancedWithinLease,
        )
          ? undefined
          : await pendingApprovalForCurrentEpoch(run.id, node.id);
        if (!existing) {
          return requireLeased(
            lease,
            store.createApprovalAndWaitIfLeased({
              guard: guardFor(lease),
              approval: {
                runId: run.id,
                nodeId: node.id,
                approvalName: node.name,
                status: 'pending',
                assignees: node.assignees,
                ...(node.timeout !== undefined
                  ? { expiresAt: resolveTimeoutAt(node.timeout) }
                  : {}),
                payload: { state: run.state, timeout: node.timeout, assignees: node.assignees },
              },
              event: {
                runId: run.id,
                nodeId: node.id,
                type: 'APPROVAL_REQUESTED',
              },
              runPatch: { status: 'waiting_for_approval', currentNode: node.id },
            }),
            'approval wait',
          );
        }
        return requireLeased(
          lease,
          store.updateRunIfLeased({
            guard: guardFor(lease),
            runId: run.id,
            patch: { status: 'waiting_for_approval', currentNode: node.id },
          }),
          'approval wait run update',
        );
      }
      if (node.kind === 'timer') {
        const resumeAt = resolveTimerResumeAt(node.resumeAt, node.delay);
        const existingTimer = (await store.snapshot()).timers.find(
          (timer) =>
            timer.runId === run.id &&
            timer.nodeId === node.id &&
            timer.status === 'scheduled' &&
            timerMatchesRunReplayEpoch(run, timer),
        );
        if (!existingTimer) {
          await requireLeased(
            lease,
            store.createTimerIfLeased({
              guard: guardFor(lease),
              timer: {
                runId: run.id,
                nodeId: node.id,
                resumeAt,
                status: 'scheduled',
                payload: { state: run.state },
              },
            }),
            'timer create',
          );
        }
        await requireLeased(
          lease,
          store.appendTimelineIfLeased({
            guard: guardFor(lease),
            event: {
              runId: run.id,
              nodeId: node.id,
              type: 'TIMER_WAITING',
              payload: { ...node, resumeAt: resumeAt.toISOString() },
            },
          }),
          'timer wait timeline append',
        );
        return requireLeased(
          lease,
          store.updateRunIfLeased({
            guard: guardFor(lease),
            runId: run.id,
            patch: { status: 'waiting_for_timer', currentNode: node.id },
          }),
          'timer wait run update',
        );
      }
      if (node.kind === 'condition' && !evaluateWorkflowExpression(node.when, run.state)) {
        run = await advance(run, node.id, 'CONDITION_SKIPPED', lease);
        advancedWithinLease = true;
        continue;
      }
      if (node.kind === 'step') {
        if (canStartStepWithoutHistory(run, node, recoverCompletedSteps)) {
          const nextRun = await executeFastInternalStep(run, node, workflow, lease, 1);
          if (nextRun.status !== 'running') {
            return nextRun;
          }
          run = nextRun;
          advancedWithinLease = true;
          continue;
        }
        if (
          canStartRetryStepWithoutHistory(
            run,
            node,
            recoverCompletedSteps,
            freshRun,
            advancedWithinLease,
          )
        ) {
          const nextRun = await executeFastRetryInternalStep(run, node, workflow, lease, 1);
          if (nextRun.status !== 'running') {
            return nextRun;
          }
          run = nextRun;
          advancedWithinLease = true;
          continue;
        }
        const prepared = await prepareStepExecution(run, node, lease);
        if (prepared.kind === 'restored') {
          run = prepared.run;
          continue;
        }
        const nextRun = await executeStep(run, node, workflow, lease, prepared.attempt, options);
        if (nextRun.status !== 'running') {
          return nextRun;
        }
        run = nextRun;
        advancedWithinLease = true;
        continue;
      }
      run = await advance(run, node.id, `${node.kind.toUpperCase()}_COMPLETED`, lease);
      advancedWithinLease = true;
    }
  }

  function canStartStepWithoutHistory(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
    recoverCompletedSteps: boolean,
  ): boolean {
    return (
      !recoverCompletedSteps &&
      node.retry === undefined &&
      node.sideEffects !== 'external' &&
      replayEpochForState(run.state) === undefined
    );
  }

  function canStartRetryStepWithoutHistory(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
    recoverCompletedSteps: boolean,
    freshRun: boolean,
    advancedWithinLease: boolean,
  ): boolean {
    return (
      !recoverCompletedSteps &&
      node.retry !== undefined &&
      node.sideEffects !== 'external' &&
      replayEpochForState(run.state) === undefined &&
      (freshRun || advancedWithinLease)
    );
  }

  function canCreateApprovalWithoutHistory(
    run: WorkflowRunRecord,
    recoverCompletedSteps: boolean,
    freshRun: boolean,
    advancedWithinLease: boolean,
  ): boolean {
    return (
      !recoverCompletedSteps &&
      replayEpochForState(run.state) === undefined &&
      (freshRun || advancedWithinLease)
    );
  }

  async function executeFastInternalStep(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
    workflow: WorkflowDefinitionIR,
    lease: RuntimeLease,
    attempt: number,
  ): Promise<WorkflowRunRecord> {
    const handler = steps[node.name] ?? steps[node.run];
    const startedAt = new Date();
    try {
      if (!handler) {
        throw new Error(`Workflow step handler not found for "${node.name}" at ${node.run}`);
      }
      const activeRunStartedAt = run.startedAt ?? startedAt;
      const activeRun: WorkflowRunRecord = {
        ...run,
        status: 'running',
        startedAt: activeRunStartedAt,
      };
      const handlerState = handlerStateFrom(run.state);
      const handlerInput = deepClone(run.input);
      const output =
        (await withLeaseHeartbeat(lease, () =>
          handler({
            run: { ...activeRun, state: handlerState, input: handlerInput },
            workflow,
            step: node,
            state: handlerState,
            input: handlerInput,
            outbox: async (entry) => {
              await requireLeased(
                lease,
                store.createOutboxIfLeased({
                  guard: guardFor(lease),
                  outbox: {
                    runId: run.id,
                    nodeId: node.id,
                    destination: entry.destination,
                    ...(entry.idempotencyKey !== undefined
                      ? { idempotencyKey: entry.idempotencyKey }
                      : {}),
                    payload: entry.payload,
                    status: 'pending',
                  },
                }),
                'step context outbox create',
              );
            },
          }),
        )) ?? {};
      const completedAt = new Date();
      const nextState = mergeWorkflowState(run.state, output);
      const nextNode = await nextNodeId(run, node.id);
      const completed = await requireLeased(
        lease,
        store.createCompletedStepAndAdvanceIfLeased({
          guard: guardFor(lease),
          step: {
            runId: run.id,
            nodeId: node.id,
            stepName: node.name,
            attempt,
            status: 'completed',
            input: run.state,
            output,
            startedAt,
            completedAt,
          },
          startedEvent: {
            runId: run.id,
            nodeId: node.id,
            type: 'STEP_STARTED',
            payload: { attempt },
          },
          completedEvent: {
            runId: run.id,
            nodeId: node.id,
            type: 'STEP_COMPLETED',
            payload: output,
          },
          ...(nextNode === undefined
            ? {
                terminalEvent: {
                  runId: run.id,
                  type: 'RUN_COMPLETED',
                  payload: nextState,
                },
              }
            : {}),
          snapshot: {
            runId: run.id,
            nodeId: node.id,
            state: nextState,
            diff: shallowStateDiff(run.state, nextState),
          },
          runPatch: {
            state: nextState,
            currentNode: nextNode,
            status: nextNode === undefined ? 'completed' : 'running',
            error: null,
            startedAt: activeRunStartedAt,
            ...(nextNode === undefined ? { output: nextState, completedAt } : {}),
          },
          releaseRunLease: nextNode === undefined,
        }),
        'fast step completion',
      );
      if (nextNode === undefined) {
        markRuntimeLeaseReleased(lease);
      }
      return completed;
    } catch (error) {
      if (isLeaseLost(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const stepRun = await requireLeased(
        lease,
        store.createStepRunIfLeased({
          guard: guardFor(lease),
          step: {
            runId: run.id,
            nodeId: node.id,
            stepName: node.name,
            attempt,
            status: 'running',
            input: run.state,
            startedAt,
          },
        }),
        'fast failed step create',
      );
      await requireLeased(
        lease,
        store.appendTimelineIfLeased({
          guard: guardFor(lease),
          event: {
            runId: run.id,
            nodeId: node.id,
            type: 'STEP_STARTED',
            payload: { attempt },
          },
        }),
        'fast failed step start timeline append',
      );
      return failStepPermanently(run, node, stepRun, lease, message);
    }
  }

  async function executeFastRetryInternalStep(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
    workflow: WorkflowDefinitionIR,
    lease: RuntimeLease,
    attempt: number,
  ): Promise<WorkflowRunRecord> {
    const handler = steps[node.name] ?? steps[node.run];
    const startedAt = new Date();
    try {
      if (!handler) {
        throw new Error(`Workflow step handler not found for "${node.name}" at ${node.run}`);
      }
      const activeRunStartedAt = run.startedAt ?? startedAt;
      const activeRun: WorkflowRunRecord = {
        ...run,
        status: 'running',
        startedAt: activeRunStartedAt,
      };
      const handlerState = handlerStateFrom(run.state);
      const handlerInput = deepClone(run.input);
      const output =
        (await withLeaseHeartbeat(lease, () =>
          handler({
            run: { ...activeRun, state: handlerState, input: handlerInput },
            workflow,
            step: node,
            state: handlerState,
            input: handlerInput,
            outbox: async (entry) => {
              await requireLeased(
                lease,
                store.createOutboxIfLeased({
                  guard: guardFor(lease),
                  outbox: {
                    runId: run.id,
                    nodeId: node.id,
                    destination: entry.destination,
                    ...(entry.idempotencyKey !== undefined
                      ? { idempotencyKey: entry.idempotencyKey }
                      : {}),
                    payload: entry.payload,
                    status: 'pending',
                  },
                }),
                'step context outbox create',
              );
            },
          }),
        )) ?? {};
      const completedAt = new Date();
      const nextState = mergeWorkflowState(run.state, output);
      const nextNode = await nextNodeId(run, node.id);
      const completed = await requireLeased(
        lease,
        store.createCompletedStepAndAdvanceIfLeased({
          guard: guardFor(lease),
          step: {
            runId: run.id,
            nodeId: node.id,
            stepName: node.name,
            attempt,
            status: 'completed',
            input: run.state,
            output,
            startedAt,
            completedAt,
          },
          startedEvent: {
            runId: run.id,
            nodeId: node.id,
            type: 'STEP_STARTED',
            payload: { attempt },
          },
          completedEvent: {
            runId: run.id,
            nodeId: node.id,
            type: 'STEP_COMPLETED',
            payload: output,
          },
          ...(nextNode === undefined
            ? {
                terminalEvent: {
                  runId: run.id,
                  type: 'RUN_COMPLETED',
                  payload: nextState,
                },
              }
            : {}),
          snapshot: {
            runId: run.id,
            nodeId: node.id,
            state: nextState,
            diff: shallowStateDiff(run.state, nextState),
          },
          runPatch: {
            state: nextState,
            currentNode: nextNode,
            status: nextNode === undefined ? 'completed' : 'running',
            error: null,
            startedAt: activeRunStartedAt,
            ...(nextNode === undefined ? { output: nextState, completedAt } : {}),
          },
          releaseRunLease: nextNode === undefined,
        }),
        'fast retry step completion',
      );
      if (nextNode === undefined) {
        markRuntimeLeaseReleased(lease);
      }
      return completed;
    } catch (error) {
      if (isLeaseLost(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const stepRun = await requireLeased(
        lease,
        store.createStepRunAndAppendStartedTimelineIfLeased({
          guard: guardFor(lease),
          step: {
            runId: run.id,
            nodeId: node.id,
            stepName: node.name,
            attempt,
            status: 'running',
            input: run.state,
            startedAt,
          },
          event: {
            runId: run.id,
            nodeId: node.id,
            type: 'STEP_STARTED',
            payload: { attempt },
          },
        }),
        'fast retry failed step start',
      );
      const maxAttempts = node.retry?.maxAttempts ?? 1;
      if (attempt < maxAttempts) {
        const nextAttempt = attempt + 1;
        return requireLeased(
          lease,
          store.failStepAndScheduleRetryIfLeased({
            guard: guardFor(lease),
            runId: run.id,
            stepRunId: stepRun.id,
            message,
            completedAt: new Date(),
            event: {
              runId: run.id,
              nodeId: node.id,
              type: 'STEP_RETRY_SCHEDULED',
              payload: {
                attempt,
                nextAttempt,
                backoff: node.retry?.backoff ?? 'exponential',
              },
            },
            runPatch: {
              status: 'queued',
              currentNode: node.id,
              error: { message },
            },
          }),
          'fast retry schedule',
        );
      }
      return failStepPermanently(run, node, stepRun, lease, message);
    }
  }

  async function executeStep(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
    workflow: WorkflowDefinitionIR,
    lease: RuntimeLease,
    attempt: number,
    options: RunUntilBlockedOptions = {},
  ): Promise<WorkflowRunRecord> {
    const handler = steps[node.name] ?? steps[node.run];
    if (node.sideEffects === 'external' && !hasResolvableIdempotencyKey(node, run.state)) {
      const existingOutbox = await existingOutboxForRunNode(run, node);
      if (existingOutbox) {
        return recoverExistingExternalOutbox(run, node, existingOutbox, lease);
      }
    }
    const startedAt = new Date();
    if (node.sideEffects === 'external') {
      let idempotencyKey: string | undefined;
      try {
        idempotencyKey = resolveExternalIdempotencyKey(node, run.state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stepRun = await requireLeased(
          lease,
          store.createStepRunIfLeased({
            guard: guardFor(lease),
            step: {
              runId: run.id,
              nodeId: node.id,
              stepName: node.name,
              attempt,
              status: 'running',
              input: run.state,
              startedAt,
            },
          }),
          'external failed step create',
        );
        return failStepPermanently(run, node, stepRun, lease, message);
      }
      const paused = await store.createExternalStepOutboxAndPauseIfLeased({
        guard: guardFor(lease),
        step: {
          runId: run.id,
          nodeId: node.id,
          stepName: node.name,
          attempt,
          status: 'running',
          input: run.state,
          startedAt,
        },
        outbox: {
          runId: run.id,
          nodeId: node.id,
          destination: node.run,
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
          payload: { state: run.state, input: run.input },
          status: 'pending',
        },
        runPatch: {
          status: 'paused',
          currentNode: node.id,
        },
        ...(options.continueExternalOutbox
          ? {
              claimOutboxLease: {
                workerId: leaseOwner(),
                ttlMs: OUTBOX_LEASE_TTL_MS,
              },
            }
          : {}),
      });
      if (paused) {
        const pausedOutboxPayload = recordFromUnknown(paused.outbox.payload);
        if (
          options.continueExternalOutbox &&
          paused.outbox.status === 'pending' &&
          stringFromUnknown(pausedOutboxPayload['stepRunId']) === paused.stepRun.id
        ) {
          const outboxLease =
            paused.outboxLease !== undefined
              ? runtimeLeaseFromRecord(paused.outboxLease, OUTBOX_LEASE_TTL_MS)
              : undefined;
          const fallbackOutboxLease =
            outboxLease ??
            (await store.acquireLease({
              resourceType: 'outbox',
              resourceId: paused.outbox.id,
              workerId: leaseOwner(),
              ttlMs: OUTBOX_LEASE_TTL_MS,
            }));
          if (fallbackOutboxLease) {
            return dispatchClaimedExternalOutbox({
              outbox: paused.outbox,
              outboxLease:
                'leaseId' in fallbackOutboxLease
                  ? fallbackOutboxLease
                  : runtimeLeaseFromRecord(fallbackOutboxLease, OUTBOX_LEASE_TTL_MS),
              dispatchRun: paused.run,
              runLease: lease,
              dispatchNode: node,
              stepRun: paused.stepRun,
              outboxPayload: pausedOutboxPayload,
              continueRun: true,
              skipOutboxWaiterResume: true,
            });
          }
        }
        return paused.run;
      }
      const stepRun = await requireLeased(
        lease,
        store.createStepRunIfLeased({
          guard: guardFor(lease),
          step: {
            runId: run.id,
            nodeId: node.id,
            stepName: node.name,
            attempt,
            status: 'running',
            input: run.state,
            startedAt,
          },
        }),
        'step run create',
      );
      const outbox = await requireLeased(
        lease,
        store.createOutboxIfLeased({
          guard: guardFor(lease),
          outbox: {
            runId: run.id,
            nodeId: node.id,
            destination: node.run,
            ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
            payload: { state: run.state, input: run.input, stepRunId: stepRun.id },
            status: 'pending',
          },
        }),
        'outbox create',
      );
      const dispatchedPayload = recordFromUnknown(outbox.payload);
      if (!outboxMatchesRunReplayEpoch(run, outbox)) {
        return recoverEarlierEpochExternalOutbox(run, node, stepRun, outbox, lease);
      }
      if (outbox.status === 'dispatched') {
        const output = recordFromUnknown(dispatchedPayload['output']);
        return completeStepFromOutput(run, node, stepRun.id, output, lease);
      }
      if (outbox.status === 'failed') {
        const message = outboxErrorMessage(outbox) ?? 'External outbox previously failed';
        await requireLeased(
          lease,
          store.updateStepRunIfLeased({
            guard: guardFor(lease),
            stepRunId: stepRun.id,
            runId: run.id,
            patch: {
              status: 'failed',
              error: { message },
              completedAt: new Date(),
            },
          }),
          'failed outbox waiter step update',
        );
        await requireLeased(
          lease,
          store.appendTimelineIfLeased({
            guard: guardFor(lease),
            event: {
              runId: run.id,
              nodeId: node.id,
              type: 'OUTBOX_REUSED_FAILED',
              payload: { outboxId: outbox.id, destination: outbox.destination, message },
            },
          }),
          'failed outbox reuse timeline append',
        );
        return requireLeased(
          lease,
          store.updateRunIfLeased({
            guard: guardFor(lease),
            runId: run.id,
            patch: {
              status: 'failed',
              currentNode: node.id,
              error: { message },
              completedAt: new Date(),
            },
          }),
          'failed outbox reuse run update',
        );
      }
      if (outbox.status === 'pending' && dispatchedPayload['stepRunId'] !== stepRun.id) {
        await requireLeased(
          lease,
          store.updateStepRunIfLeased({
            guard: guardFor(lease),
            stepRunId: stepRun.id,
            runId: run.id,
            patch: {
              status: 'queued',
              output: outboxWaiterOutput(outbox.id),
            },
          }),
          'outbox waiter step update',
        );
      }
      return requireLeased(
        lease,
        store.appendTimelineAndUpdateRunIfLeased({
          guard: guardFor(lease),
          runId: run.id,
          event: {
            runId: run.id,
            nodeId: node.id,
            type:
              dispatchedPayload['stepRunId'] === stepRun.id ? 'OUTBOX_PENDING' : 'OUTBOX_WAITING',
            payload: { outboxId: outbox.id, destination: outbox.destination },
          },
          patch: {
            status: 'paused',
            currentNode: node.id,
          },
        }),
        'outbox pause',
      );
    }
    const stepRun = await requireLeased(
      lease,
      store.createStepRunAndAppendStartedTimelineIfLeased({
        guard: guardFor(lease),
        step: {
          runId: run.id,
          nodeId: node.id,
          stepName: node.name,
          attempt,
          status: 'running',
          input: run.state,
          startedAt,
        },
        event: {
          runId: run.id,
          nodeId: node.id,
          type: 'STEP_STARTED',
          payload: { attempt },
        },
      }),
      'step run create',
    );
    try {
      if (!handler) {
        throw new Error(`Workflow step handler not found for "${node.name}" at ${node.run}`);
      }
      const handlerState = handlerStateFrom(run.state);
      const handlerInput = deepClone(run.input);
      const output =
        (await withLeaseHeartbeat(lease, () =>
          handler({
            run: { ...run, state: handlerState, input: handlerInput },
            workflow,
            step: node,
            state: handlerState,
            input: handlerInput,
            outbox: async (entry) => {
              await requireLeased(
                lease,
                store.createOutboxIfLeased({
                  guard: guardFor(lease),
                  outbox: {
                    runId: run.id,
                    nodeId: node.id,
                    destination: entry.destination,
                    ...(entry.idempotencyKey !== undefined
                      ? { idempotencyKey: entry.idempotencyKey }
                      : {}),
                    payload: entry.payload,
                    status: 'pending',
                  },
                }),
                'step context outbox create',
              );
            },
          }),
        )) ?? {};
      return completeStepFromOutput(run, node, stepRun.id, output, lease);
    } catch (error) {
      if (isLeaseLost(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const maxAttempts = node.retry?.maxAttempts ?? 1;
      const canUseAttemptForRetryBudget = replayEpochForState(run.state) === undefined;
      const currentEpochAttempts = canUseAttemptForRetryBudget
        ? attempt
        : await currentEpochStepAttemptCount(run, node.id);
      if (currentEpochAttempts < maxAttempts) {
        const nextAttempt = canUseAttemptForRetryBudget
          ? attempt + 1
          : await nextStepAttempt(run, node.id);
        return requireLeased(
          lease,
          store.failStepAndScheduleRetryIfLeased({
            guard: guardFor(lease),
            runId: run.id,
            stepRunId: stepRun.id,
            message,
            completedAt: new Date(),
            event: {
              runId: run.id,
              nodeId: node.id,
              type: 'STEP_RETRY_SCHEDULED',
              payload: {
                attempt,
                nextAttempt,
                backoff: node.retry?.backoff ?? 'exponential',
              },
            },
            runPatch: {
              status: 'queued',
              currentNode: node.id,
              error: { message },
            },
          }),
          'step retry schedule',
        );
      }
      await requireLeased(
        lease,
        store.updateStepRunIfLeased({
          guard: guardFor(lease),
          stepRunId: stepRun.id,
          runId: run.id,
          patch: {
            status: 'failed',
            error: { message },
            completedAt: new Date(),
          },
        }),
        'step failure update',
      );
      await requireLeased(
        lease,
        store.createDeadLetterIfLeased({
          guard: guardFor(lease),
          deadLetter: {
            kind: 'step',
            resourceId: run.id,
            reason: message,
            payload: { node },
          },
        }),
        'step dead letter create',
      );
      await requireLeased(
        lease,
        store.appendTimelineIfLeased({
          guard: guardFor(lease),
          event: {
            runId: run.id,
            nodeId: node.id,
            type: 'STEP_FAILED',
            payload: { message },
          },
        }),
        'step failure timeline append',
      );
      return requireLeased(
        lease,
        store.updateRunIfLeased({
          guard: guardFor(lease),
          runId: run.id,
          patch: {
            status: 'failed',
            currentNode: node.id,
            error: { message },
            completedAt: new Date(),
          },
        }),
        'step failure run update',
      );
    }
  }

  async function existingOutboxForRunNode(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
  ): Promise<WorkflowOutboxRecord | undefined> {
    const inspection = await store.inspectRun({
      runId: run.id,
      include: { steps: true, outbox: true },
    });
    return (inspection?.outbox ?? [])
      .filter((outbox) => outbox.runId === run.id)
      .filter((outbox) => outbox.nodeId === node.id)
      .filter((outbox) => outbox.destination === node.run)
      .filter((outbox) => outboxMatchesRunReplayEpoch(run, outbox))
      .filter((outbox) => {
        const stepRunId = stringFromUnknown(recordFromUnknown(outbox.payload)['stepRunId']);
        if (!stepRunId) return false;
        return (inspection?.steps ?? []).some(
          (step) =>
            step.id === stepRunId &&
            step.runId === run.id &&
            step.nodeId === node.id &&
            stepMatchesRunReplayEpoch(run, step),
        );
      })
      .sort((left, right) => right.createdAt.valueOf() - left.createdAt.valueOf())[0];
  }

  async function recoverExistingExternalOutbox(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
    outbox: WorkflowOutboxRecord,
    lease: RuntimeLease,
  ): Promise<WorkflowRunRecord> {
    if (outbox.status === 'pending') {
      await requireLeased(
        lease,
        store.appendTimelineIfLeased({
          guard: guardFor(lease),
          event: {
            runId: run.id,
            nodeId: node.id,
            type: 'OUTBOX_PENDING',
            payload: { outboxId: outbox.id, destination: outbox.destination, recovered: true },
          },
        }),
        'existing outbox pending timeline append',
      );
      return requireLeased(
        lease,
        store.updateRunIfLeased({
          guard: guardFor(lease),
          runId: run.id,
          patch: {
            status: 'paused',
            currentNode: node.id,
          },
        }),
        'existing outbox pause run update',
      );
    }

    const attempt = await nextStepAttempt(run, node.id);
    const stepRun = await requireLeased(
      lease,
      store.createStepRunIfLeased({
        guard: guardFor(lease),
        step: {
          runId: run.id,
          nodeId: node.id,
          stepName: node.name,
          attempt,
          status: 'running',
          input: run.state,
          startedAt: new Date(),
        },
      }),
      'existing outbox recovery step create',
    );
    if (outbox.status === 'dispatched') {
      const output = recordFromUnknown(recordFromUnknown(outbox.payload)['output']);
      return completeStepFromOutput(run, node, stepRun.id, output, lease);
    }
    return failStepPermanently(
      run,
      node,
      stepRun,
      lease,
      outboxErrorMessage(outbox) ?? 'External outbox previously failed',
    );
  }

  async function recoverEarlierEpochExternalOutbox(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
    stepRun: WorkflowStepRunRecord,
    outbox: WorkflowOutboxRecord,
    lease: RuntimeLease,
  ): Promise<WorkflowRunRecord> {
    const outboxPayload = recordFromUnknown(outbox.payload);
    const priorStepRunId = stringFromUnknown(outboxPayload['stepRunId']);
    const inspection = await store.inspectRun({ runId: run.id, include: { steps: true } });
    const priorStep = (inspection?.steps ?? []).find(
      (candidate) =>
        candidate.id === priorStepRunId &&
        candidate.runId === run.id &&
        candidate.nodeId === node.id &&
        candidate.status === 'completed',
    );
    if (outbox.status !== 'dispatched' || !priorStep) {
      return failStepPermanently(
        run,
        node,
        stepRun,
        lease,
        `External step "${node.name}" found an outbox from an earlier replay epoch. Use a fork replay or provide a fresh idempotency key.`,
      );
    }
    await requireLeased(
      lease,
      store.appendTimelineIfLeased({
        guard: guardFor(lease),
        event: {
          runId: run.id,
          nodeId: node.id,
          type: 'STEP_RESTORED',
          payload: { attempt: priorStep.attempt, outboxId: outbox.id, replay: 'earlier-epoch' },
        },
      }),
      'earlier epoch external outbox restore timeline append',
    );
    return completeStepFromOutput(
      run,
      node,
      stepRun.id,
      recordFromUnknown(outboxPayload['output']),
      lease,
    );
  }

  async function dispatchNextOutbox(
    now = new Date(),
    options: { readonly continueRun?: boolean } = {},
  ): Promise<WorkflowRunRecord | undefined> {
    await ensureReady();
    const pairedClaim = await claimNextOutboxAndRunWithLeases(now);
    let outbox: WorkflowOutboxRecord;
    let outboxLease: RuntimeLease;
    let pairedRun: WorkflowRunRecord | undefined;
    let pairedRunLease: RuntimeLease | undefined;
    if (pairedClaim) {
      outbox = pairedClaim.outbox;
      outboxLease = pairedClaim.outboxLease;
      pairedRun = pairedClaim.run;
      pairedRunLease = pairedClaim.runLease;
    } else {
      const claimedOutbox = await claimNextOutboxWithLease(now);
      if (!claimedOutbox) return undefined;
      outbox = claimedOutbox.outbox;
      outboxLease = claimedOutbox.lease;
    }
    let runLease: RuntimeLease | undefined;
    let claimedRun: WorkflowRunRecord | undefined;
    let node: WorkflowStepIR | undefined;
    let stepRun: WorkflowStepRunRecord | undefined;
    let outboxPayload: Record<string, unknown> = {};
    let outboxLeaseReleased = false;
    try {
      let dispatchRun: WorkflowRunRecord;
      let claimedRunLease: RuntimeLease;
      if (pairedRun && pairedRunLease) {
        dispatchRun = pairedRun;
        claimedRunLease = pairedRunLease;
      } else {
        const fallbackRunClaim = await claimRunWithLease(outbox.runId);
        if (!fallbackRunClaim) {
          return await recoverOutboxForUnclaimableRun(outbox, outboxLease);
        }
        dispatchRun = fallbackRunClaim.run;
        claimedRunLease = fallbackRunClaim.lease;
      }
      claimedRun = dispatchRun;
      runLease = claimedRunLease;
      const workflow = await workflowForRun(dispatchRun);
      const foundNode = workflow.nodes.find(
        (candidate) => candidate.kind === 'step' && candidate.id === outbox.nodeId,
      );
      if (!foundNode || foundNode.kind !== 'step') {
        return await deadLetterOutboxOnly({
          outbox,
          message: `Workflow outbox step not found: ${outbox.nodeId}`,
          runLease: claimedRunLease,
          outboxLease,
          run: dispatchRun,
        });
      }
      const dispatchNode = foundNode;
      node = foundNode;
      if (dispatchNode.sideEffects !== 'external') {
        return await deadLetterOutboxOnly({
          outbox,
          message: `Workflow outbox ${outbox.id} is not attached to an external step.`,
          runLease: claimedRunLease,
          outboxLease,
          run: dispatchRun,
        });
      }
      if (outbox.destination !== dispatchNode.run) {
        return await deadLetterOutboxOnly({
          outbox,
          message: `Workflow outbox ${outbox.id} destination does not match external step ${dispatchNode.name}.`,
          runLease: claimedRunLease,
          outboxLease,
          run: dispatchRun,
        });
      }
      outboxPayload = recordFromUnknown(outbox.payload);
      if (!outboxMatchesRunReplayEpoch(dispatchRun, outbox)) {
        return await deadLetterOutboxOnly({
          outbox,
          message: `Workflow outbox ${outbox.id} belongs to an earlier replay epoch.`,
          runLease: claimedRunLease,
          outboxLease,
          run: dispatchRun,
        });
      }
      const stepRunId = stringFromUnknown(outboxPayload['stepRunId']);
      if (!stepRunId) {
        return await deadLetterOutboxOnly({
          outbox,
          message: `Workflow outbox ${outbox.id} is missing an external stepRunId.`,
          runLease: claimedRunLease,
          outboxLease,
          run: dispatchRun,
        });
      }
      const referencedStepRun = pairedClaim?.stepRun ?? (await store.findStepRun(stepRunId));
      if (
        !referencedStepRun ||
        referencedStepRun.runId !== outbox.runId ||
        referencedStepRun.nodeId !== outbox.nodeId ||
        !stepMatchesRunReplayEpoch(dispatchRun, referencedStepRun)
      ) {
        return await deadLetterOutboxOnly({
          outbox,
          message: `Workflow outbox ${outbox.id} references an invalid external step run.`,
          runLease: claimedRunLease,
          outboxLease,
          run: dispatchRun,
        });
      }
      const completedStepRun =
        referencedStepRun.status === 'completed' ? referencedStepRun : undefined;
      const retryStepRun =
        referencedStepRun.status === 'failed'
          ? (await store.inspectRun({ runId: dispatchRun.id, include: { steps: true } }))?.steps
              ?.filter(
                (candidate) =>
                  candidate.runId === outbox.runId &&
                  candidate.nodeId === outbox.nodeId &&
                  stepMatchesRunReplayEpoch(dispatchRun, candidate) &&
                  (candidate.status === 'running' || candidate.status === 'skipped'),
              )
              .sort(
                (left, right) =>
                  right.createdAt.valueOf() - left.createdAt.valueOf() ||
                  right.attempt - left.attempt,
              )[0]
          : undefined;
      stepRun =
        retryStepRun ??
        (referencedStepRun.status === 'running' ||
        referencedStepRun.status === 'skipped' ||
        referencedStepRun.status === 'failed'
          ? referencedStepRun
          : undefined);
      if (completedStepRun) {
        return await recoverCompletedOutboxDispatch({
          outbox,
          outboxLease,
          stepRun: completedStepRun,
          run: dispatchRun,
          node: dispatchNode,
          runLease: claimedRunLease,
        });
      }
      if (!stepRun) {
        return await deadLetterOutboxOnly({
          outbox,
          message: `Workflow outbox ${outbox.id} references a non-dispatchable step run.`,
          runLease: claimedRunLease,
          outboxLease,
          run: dispatchRun,
        });
      }
      if (!isRunParkedAtOutboxNode(dispatchRun, outbox)) {
        return await deadLetterOutboxOnly({
          outbox,
          message: `Workflow outbox ${outbox.id} is stale because run ${dispatchRun.id} is no longer waiting at ${outbox.nodeId}.`,
          runLease: claimedRunLease,
          outboxLease,
          run: dispatchRun,
        });
      }
      const handler = steps[dispatchNode.name] ?? steps[dispatchNode.run];
      if (!handler) {
        return await failOutboxDispatch({
          outbox,
          message: `Workflow step handler not found for "${dispatchNode.name}" at ${dispatchNode.run}`,
          runLease: claimedRunLease,
          outboxLease,
          stepRun,
        });
      }
      if (stepRun.status === 'failed') {
        const retry = await scheduleOutboxRetry({
          run: dispatchRun,
          node: dispatchNode,
          stepRun,
          outbox,
          outboxPayload,
          message: outboxErrorMessage(outbox) ?? 'Recovering failed external step attempt',
          runLease: claimedRunLease,
          outboxLease,
        });
        if (retry) return retry;
        return await failOutboxDispatch({
          outbox,
          message: outboxErrorMessage(outbox) ?? 'External step failed',
          runLease: claimedRunLease,
          outboxLease,
          stepRun,
        });
      }
      const handlerState = handlerStateFrom(dispatchRun.state);
      const handlerInput = deepClone(dispatchRun.input);
      const output =
        (await withLeaseHeartbeat([outboxLease, claimedRunLease], () =>
          handler({
            run: { ...dispatchRun, state: handlerState, input: handlerInput },
            workflow,
            step: dispatchNode,
            state: handlerState,
            input: handlerInput,
            outbox: async (entry) => {
              await requireLeased(
                claimedRunLease,
                store.createOutboxIfLeased({
                  guard: guardFor(claimedRunLease),
                  outbox: {
                    runId: dispatchRun.id,
                    nodeId: dispatchNode.id,
                    destination: entry.destination,
                    ...(entry.idempotencyKey !== undefined
                      ? { idempotencyKey: entry.idempotencyKey }
                      : {}),
                    payload: entry.payload,
                    status: 'pending',
                  },
                }),
                'outbox dispatch nested outbox create',
              );
            },
          }),
        )) ?? {};
      const nextState = mergeWorkflowState(dispatchRun.state, output);
      const completedAt = new Date();
      const next = await requireLeased(
        claimedRunLease,
        store.completeOutboxDispatchAndAdvanceIfLeased({
          runGuard: guardFor(claimedRunLease),
          outboxGuard: guardFor(outboxLease),
          runId: dispatchRun.id,
          outboxId: outbox.id,
          stepRunId: stepRun.id,
          stepOutput: output,
          completedAt,
          outboxDispatchStartedEvent: {
            runId: dispatchRun.id,
            nodeId: dispatchNode.id,
            type: 'OUTBOX_DISPATCH_STARTED',
            payload: { outboxId: outbox.id, destination: outbox.destination },
          },
          stepCompletedEvent: {
            runId: dispatchRun.id,
            nodeId: dispatchNode.id,
            type: 'STEP_COMPLETED',
            payload: output,
          },
          outboxDispatchedEvent: {
            runId: dispatchRun.id,
            nodeId: dispatchNode.id,
            type: 'OUTBOX_DISPATCHED',
            payload: { outboxId: outbox.id },
          },
          snapshot: {
            runId: dispatchRun.id,
            nodeId: dispatchNode.id,
            state: nextState,
            diff: shallowStateDiff(dispatchRun.state, nextState),
          },
          runPatch: {
            state: nextState,
            currentNode: await nextNodeId(dispatchRun, dispatchNode.id),
            status: options.continueRun ? 'running' : 'queued',
            error: null,
          },
          outboxPatch: {
            status: 'dispatched',
            attempt: stepRun.attempt,
            dispatchedAt: completedAt,
            error: null,
            payload: { ...outboxPayload, output, stepRunId: stepRun.id },
          },
          releaseOutboxLease: true,
        }),
        'outbox dispatch completion',
      );
      outboxLeaseReleased = true;
      if (options.continueRun && (next.status === 'queued' || next.status === 'running')) {
        const continued = await runUntilBlocked(next, claimedRunLease, {
          continueExternalOutbox: true,
          skipStartUpdate: next.status === 'running',
          recoverCompletedSteps: false,
        });
        await resumeOutboxWaiters(outbox, output);
        return continued;
      }
      await resumeOutboxWaiters(outbox, output);
      return next;
    } catch (error) {
      if (isLeaseLost(error)) {
        return store.findRun(outbox.runId);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (runLease && claimedRun && node && stepRun) {
        await requireLeased(
          runLease,
          store.appendTimelineIfLeased({
            guard: guardFor(runLease),
            event: {
              runId: claimedRun.id,
              nodeId: node.id,
              type: 'OUTBOX_DISPATCH_STARTED',
              payload: { outboxId: outbox.id, destination: outbox.destination },
            },
          }),
          'outbox dispatch failure start timeline append',
        );
        const retry = await scheduleOutboxRetry({
          run: claimedRun,
          node,
          stepRun,
          outbox,
          outboxPayload,
          message,
          runLease,
          outboxLease,
        });
        if (retry) return retry;
        return await failOutboxDispatch({ outbox, message, runLease, outboxLease, stepRun });
      }
      if (!runLease) return store.findRun(outbox.runId);
      return await failOutboxDispatch({ outbox, message, runLease, outboxLease });
    } finally {
      if (!outboxLeaseReleased) {
        await releaseRuntimeLease(outboxLease);
      }
      if (runLease) {
        await releaseRuntimeLease(runLease);
      }
    }
  }

  async function dispatchClaimedExternalOutbox(input: {
    readonly outbox: WorkflowOutboxRecord;
    readonly outboxLease: RuntimeLease;
    readonly dispatchRun: WorkflowRunRecord;
    readonly runLease: RuntimeLease;
    readonly dispatchNode: WorkflowStepIR;
    readonly stepRun: WorkflowStepRunRecord;
    readonly outboxPayload: Record<string, unknown>;
    readonly continueRun?: boolean;
    readonly skipOutboxWaiterResume?: boolean;
  }): Promise<WorkflowRunRecord> {
    const handler = steps[input.dispatchNode.name] ?? steps[input.dispatchNode.run];
    let outboxLeaseReleased = false;
    try {
      if (!handler) {
        return await failOutboxDispatch({
          outbox: input.outbox,
          message: `Workflow step handler not found for "${input.dispatchNode.name}" at ${input.dispatchNode.run}`,
          runLease: input.runLease,
          outboxLease: input.outboxLease,
          stepRun: input.stepRun,
        });
      }
      const workflow = await workflowForRun(input.dispatchRun);
      const handlerState = handlerStateFrom(input.dispatchRun.state);
      const handlerInput = deepClone(input.dispatchRun.input);
      const output =
        (await withLeaseHeartbeat([input.outboxLease, input.runLease], () =>
          handler({
            run: { ...input.dispatchRun, state: handlerState, input: handlerInput },
            workflow,
            step: input.dispatchNode,
            state: handlerState,
            input: handlerInput,
            outbox: async (entry) => {
              await requireLeased(
                input.runLease,
                store.createOutboxIfLeased({
                  guard: guardFor(input.runLease),
                  outbox: {
                    runId: input.dispatchRun.id,
                    nodeId: input.dispatchNode.id,
                    destination: entry.destination,
                    ...(entry.idempotencyKey !== undefined
                      ? { idempotencyKey: entry.idempotencyKey }
                      : {}),
                    payload: entry.payload,
                    status: 'pending',
                  },
                }),
                'inline outbox dispatch nested outbox create',
              );
            },
          }),
        )) ?? {};
      const nextState = mergeWorkflowState(input.dispatchRun.state, output);
      const completedAt = new Date();
      const next = await requireLeased(
        input.runLease,
        store.completeOutboxDispatchAndAdvanceIfLeased({
          runGuard: guardFor(input.runLease),
          outboxGuard: guardFor(input.outboxLease),
          runId: input.dispatchRun.id,
          outboxId: input.outbox.id,
          stepRunId: input.stepRun.id,
          stepOutput: output,
          completedAt,
          outboxDispatchStartedEvent: {
            runId: input.dispatchRun.id,
            nodeId: input.dispatchNode.id,
            type: 'OUTBOX_DISPATCH_STARTED',
            payload: { outboxId: input.outbox.id, destination: input.outbox.destination },
          },
          stepCompletedEvent: {
            runId: input.dispatchRun.id,
            nodeId: input.dispatchNode.id,
            type: 'STEP_COMPLETED',
            payload: output,
          },
          outboxDispatchedEvent: {
            runId: input.dispatchRun.id,
            nodeId: input.dispatchNode.id,
            type: 'OUTBOX_DISPATCHED',
            payload: { outboxId: input.outbox.id },
          },
          snapshot: {
            runId: input.dispatchRun.id,
            nodeId: input.dispatchNode.id,
            state: nextState,
            diff: shallowStateDiff(input.dispatchRun.state, nextState),
          },
          runPatch: {
            state: nextState,
            currentNode: await nextNodeId(input.dispatchRun, input.dispatchNode.id),
            status: input.continueRun ? 'running' : 'queued',
            error: null,
          },
          outboxPatch: {
            status: 'dispatched',
            attempt: input.stepRun.attempt,
            dispatchedAt: completedAt,
            error: null,
            payload: { ...input.outboxPayload, output, stepRunId: input.stepRun.id },
          },
          releaseOutboxLease: true,
        }),
        'inline outbox dispatch completion',
      );
      outboxLeaseReleased = true;
      if (input.skipOutboxWaiterResume !== true) {
        await resumeOutboxWaiters(input.outbox, output);
      }
      if (input.continueRun && (next.status === 'queued' || next.status === 'running')) {
        return runUntilBlocked(next, input.runLease, {
          continueExternalOutbox: true,
          skipStartUpdate: next.status === 'running',
          recoverCompletedSteps: false,
        });
      }
      return next;
    } catch (error) {
      if (isLeaseLost(error)) {
        return (await store.findRun(input.outbox.runId)) ?? input.dispatchRun;
      }
      const message = error instanceof Error ? error.message : String(error);
      await requireLeased(
        input.runLease,
        store.appendTimelineIfLeased({
          guard: guardFor(input.runLease),
          event: {
            runId: input.dispatchRun.id,
            nodeId: input.dispatchNode.id,
            type: 'OUTBOX_DISPATCH_STARTED',
            payload: { outboxId: input.outbox.id, destination: input.outbox.destination },
          },
        }),
        'inline outbox dispatch failure start timeline append',
      );
      const retry = await scheduleOutboxRetry({
        run: input.dispatchRun,
        node: input.dispatchNode,
        stepRun: input.stepRun,
        outbox: input.outbox,
        outboxPayload: input.outboxPayload,
        message,
        runLease: input.runLease,
        outboxLease: input.outboxLease,
      });
      if (retry) return retry;
      return await failOutboxDispatch({
        outbox: input.outbox,
        message,
        runLease: input.runLease,
        outboxLease: input.outboxLease,
        stepRun: input.stepRun,
      });
    } finally {
      if (!outboxLeaseReleased) {
        await releaseRuntimeLease(input.outboxLease);
      }
    }
  }

  async function recoverOutboxForUnclaimableRun(
    outbox: WorkflowOutboxRecord,
    outboxLease: RuntimeLease,
  ): Promise<WorkflowRunRecord | undefined> {
    const run = await store.findRun(outbox.runId);
    if (!run || !isTerminalRunStatus(run.status)) return undefined;
    const workflow = await workflowForRun(run);
    const node = workflow.nodes.find(
      (candidate) => candidate.kind === 'step' && candidate.id === outbox.nodeId,
    );
    const stepRunId = stringFromUnknown(recordFromUnknown(outbox.payload)['stepRunId']);
    if (
      !node ||
      node.kind !== 'step' ||
      node.sideEffects !== 'external' ||
      outbox.destination !== node.run ||
      !stepRunId ||
      !outboxMatchesRunReplayEpoch(run, outbox)
    ) {
      return failTerminalOutbox(
        outbox,
        outboxLease,
        run,
        'Terminal outbox is not a verified external step dispatch',
      );
    }
    const inspection = await store.inspectRun({ runId: run.id, include: { steps: true } });
    const completed = inspection?.steps
      ?.filter(
        (step) =>
          step.id === stepRunId &&
          step.runId === outbox.runId &&
          step.nodeId === outbox.nodeId &&
          step.status === 'completed' &&
          stepMatchesRunReplayEpoch(run, step),
      )
      .sort((left, right) => right.createdAt.valueOf() - left.createdAt.valueOf())[0];
    if (completed) {
      return recoverCompletedOutboxDispatch({ outbox, outboxLease, stepRun: completed });
    }
    const terminalMessage =
      run.status === 'completed'
        ? 'Workflow completed before this outbox dispatch could be verified'
        : (runErrorMessage(run) ?? 'Workflow run did not dispatch outbox');
    return failTerminalOutbox(outbox, outboxLease, run, terminalMessage);
  }

  async function failTerminalOutbox(
    outbox: WorkflowOutboxRecord,
    outboxLease: RuntimeLease,
    run: WorkflowRunRecord,
    message: string,
  ): Promise<WorkflowRunRecord> {
    await store.createDeadLetter({
      kind: 'step',
      resourceId: run.id,
      reason: message,
      payload: { outboxId: outbox.id },
    });
    await requireLeased(
      outboxLease,
      store.updateOutboxIfLeased({
        guard: guardFor(outboxLease),
        outboxId: outbox.id,
        patch: { status: 'failed', error: { message } },
      }),
      'terminal run outbox reconciliation',
    );
    await failOutboxWaiters(outbox, message);
    return run;
  }

  async function recoverCompletedOutboxDispatch(input: {
    readonly outbox: WorkflowOutboxRecord;
    readonly outboxLease: RuntimeLease;
    readonly stepRun: WorkflowStepRunRecord;
    readonly run?: WorkflowRunRecord;
    readonly node?: WorkflowStepIR;
    readonly runLease?: RuntimeLease;
  }): Promise<WorkflowRunRecord | undefined> {
    const output = recordFromUnknown(input.stepRun.output);
    let recoveredRun: WorkflowRunRecord | undefined;
    if (
      input.run &&
      input.node &&
      input.runLease &&
      input.run.status === 'paused' &&
      input.run.currentNode === input.node.id
    ) {
      const nextState = mergeWorkflowState(input.run.state, output);
      await requireLeased(
        input.runLease,
        store.appendSnapshotIfLeased({
          guard: guardFor(input.runLease),
          snapshot: { runId: input.run.id, nodeId: input.node.id, state: nextState },
        }),
        'completed outbox recovery snapshot append',
      );
      recoveredRun = await requireLeased(
        input.runLease,
        store.updateRunIfLeased({
          guard: guardFor(input.runLease),
          runId: input.run.id,
          patch: {
            state: nextState,
            currentNode: await nextNodeId(input.run, input.node.id),
            status: 'queued',
            error: null,
          },
        }),
        'completed outbox recovery run update',
      );
    }
    await requireLeased(
      input.outboxLease,
      store.updateOutboxIfLeased({
        guard: guardFor(input.outboxLease),
        outboxId: input.outbox.id,
        patch: {
          status: 'dispatched',
          attempt: input.stepRun.attempt,
          dispatchedAt: new Date(),
          error: null,
          payload: {
            ...recordFromUnknown(input.outbox.payload),
            output,
            stepRunId: input.stepRun.id,
          },
        },
      }),
      'completed outbox reconciliation',
    );
    await resumeOutboxWaiters(input.outbox, output);
    return recoveredRun ?? store.findRun(input.outbox.runId);
  }

  async function failOutboxDispatch(input: {
    readonly outbox: WorkflowOutboxRecord;
    readonly message: string;
    readonly runLease: RuntimeLease;
    readonly outboxLease: RuntimeLease;
    readonly stepRun?: WorkflowStepRunRecord;
  }): Promise<WorkflowRunRecord> {
    if (input.stepRun) {
      await requireLeased(
        input.runLease,
        store.updateStepRunIfLeased({
          guard: guardFor(input.runLease),
          stepRunId: input.stepRun.id,
          runId: input.outbox.runId,
          patch: {
            status: 'failed',
            error: { message: input.message },
            completedAt: new Date(),
          },
        }),
        'outbox terminal failure step update',
      );
    }
    await requireLeased(
      input.runLease,
      store.createDeadLetterIfLeased({
        guard: guardFor(input.runLease),
        deadLetter: {
          kind: 'step',
          resourceId: input.outbox.runId,
          reason: input.message,
          payload: { outboxId: input.outbox.id },
        },
      }),
      'outbox dead letter create',
    );
    await requireLeased(
      input.runLease,
      store.appendTimelineIfLeased({
        guard: guardFor(input.runLease),
        event: {
          runId: input.outbox.runId,
          nodeId: input.outbox.nodeId,
          type: 'OUTBOX_DISPATCH_FAILED',
          payload: { outboxId: input.outbox.id, message: input.message },
        },
      }),
      'outbox failure timeline append',
    );
    await failOutboxWaiters(input.outbox, input.message);
    const failedRun = await requireLeased(
      input.runLease,
      store.updateRunIfLeased({
        guard: guardFor(input.runLease),
        runId: input.outbox.runId,
        patch: {
          status: 'failed',
          currentNode: input.outbox.nodeId,
          error: { message: input.message },
          completedAt: new Date(),
        },
      }),
      'outbox failure run update',
    );
    await requireLeased(
      input.outboxLease,
      store.updateOutboxIfLeased({
        guard: guardFor(input.outboxLease),
        outboxId: input.outbox.id,
        patch: {
          status: 'failed',
          error: { message: input.message },
        },
      }),
      'outbox failure update',
    );
    return failedRun;
  }

  async function deadLetterOutboxOnly(input: {
    readonly outbox: WorkflowOutboxRecord;
    readonly message: string;
    readonly runLease: RuntimeLease;
    readonly outboxLease: RuntimeLease;
    readonly run: WorkflowRunRecord;
  }): Promise<WorkflowRunRecord> {
    await requireLeased(
      input.runLease,
      store.createDeadLetterIfLeased({
        guard: guardFor(input.runLease),
        deadLetter: {
          kind: 'step',
          resourceId: input.outbox.runId,
          reason: input.message,
          payload: { outboxId: input.outbox.id },
        },
      }),
      'outbox-only dead letter create',
    );
    await requireLeased(
      input.runLease,
      store.appendTimelineIfLeased({
        guard: guardFor(input.runLease),
        event: {
          runId: input.outbox.runId,
          nodeId: input.outbox.nodeId,
          type: 'OUTBOX_DISPATCH_FAILED',
          payload: { outboxId: input.outbox.id, message: input.message, runUnchanged: true },
        },
      }),
      'outbox-only failure timeline append',
    );
    await failOutboxWaiters(input.outbox, input.message);
    const outboxPatch: Partial<WorkflowOutboxRecord> = {
      status: 'failed',
      error: { message: input.message },
      ...(input.outbox.idempotencyKey !== undefined
        ? { idempotencyKey: `${input.outbox.idempotencyKey}:failed:${input.outbox.id}` }
        : {}),
    };
    await requireLeased(
      input.outboxLease,
      store.updateOutboxIfLeased({
        guard: guardFor(input.outboxLease),
        outboxId: input.outbox.id,
        patch: outboxPatch,
      }),
      'outbox-only failure update',
    );
    if (
      isRunParkedAtOutboxNode(input.run, input.outbox) &&
      !(await hasOtherVerifiedOutboxForRunNode(input.run, input.outbox))
    ) {
      return requireLeased(
        input.runLease,
        store.updateRunIfLeased({
          guard: guardFor(input.runLease),
          runId: input.run.id,
          patch: {
            status: 'queued',
            currentNode: input.outbox.nodeId,
            error: { message: input.message },
          },
        }),
        'outbox-only active run requeue',
      );
    }
    return input.run;
  }

  async function hasOtherVerifiedOutboxForRunNode(
    run: WorkflowRunRecord,
    ignoredOutbox: WorkflowOutboxRecord,
  ): Promise<boolean> {
    const inspection = await store.inspectRun({
      runId: run.id,
      include: { steps: true, outbox: true },
    });
    return (inspection?.outbox ?? []).some((outbox) => {
      if (
        outbox.id === ignoredOutbox.id ||
        outbox.runId !== run.id ||
        outbox.nodeId !== ignoredOutbox.nodeId ||
        (outbox.status !== 'pending' && outbox.status !== 'dispatched') ||
        !outboxMatchesRunReplayEpoch(run, outbox)
      ) {
        return false;
      }
      const stepRunId = stringFromUnknown(recordFromUnknown(outbox.payload)['stepRunId']);
      if (!stepRunId) return false;
      return (inspection?.steps ?? []).some(
        (step) =>
          step.id === stepRunId &&
          step.runId === run.id &&
          step.nodeId === outbox.nodeId &&
          stepMatchesRunReplayEpoch(run, step),
      );
    });
  }

  function isRunParkedAtOutboxNode(run: WorkflowRunRecord, outbox: WorkflowOutboxRecord): boolean {
    return (
      (run.status === 'paused' || run.status === 'running') && run.currentNode === outbox.nodeId
    );
  }

  async function scheduleOutboxRetry(input: {
    readonly run: WorkflowRunRecord;
    readonly node: WorkflowStepIR;
    readonly stepRun: WorkflowStepRunRecord;
    readonly outbox: WorkflowOutboxRecord;
    readonly outboxPayload: Record<string, unknown>;
    readonly message: string;
    readonly runLease: RuntimeLease;
    readonly outboxLease: RuntimeLease;
  }): Promise<WorkflowRunRecord | undefined> {
    const maxAttempts = input.node.retry?.maxAttempts ?? 1;
    const currentEpochAttempts = await currentEpochStepAttemptCount(input.run, input.node.id);
    if (currentEpochAttempts >= maxAttempts) return undefined;
    const nextAttempt = await nextStepAttempt(input.run, input.node.id);
    await requireLeased(
      input.runLease,
      store.updateStepRunIfLeased({
        guard: guardFor(input.runLease),
        stepRunId: input.stepRun.id,
        runId: input.run.id,
        patch: {
          status: 'failed',
          error: { message: input.message },
          completedAt: new Date(),
        },
      }),
      'outbox retry failed step update',
    );
    const nextStepRun = await requireLeased(
      input.runLease,
      store.createStepRunIfLeased({
        guard: guardFor(input.runLease),
        step: {
          runId: input.run.id,
          nodeId: input.node.id,
          stepName: input.node.name,
          attempt: nextAttempt,
          status: 'running',
          input: input.run.state,
          startedAt: new Date(),
        },
      }),
      'outbox retry step create',
    );
    const availableAt = new Date(
      Date.now() + retryDelayMs(input.node.retry?.backoff, currentEpochAttempts + 1),
    );
    await requireLeased(
      input.outboxLease,
      store.updateOutboxIfLeased({
        guard: guardFor(input.outboxLease),
        outboxId: input.outbox.id,
        patch: {
          status: 'pending',
          attempt: nextAttempt,
          availableAt,
          error: { message: input.message },
          payload: {
            ...input.outboxPayload,
            state: input.run.state,
            input: input.run.input,
            stepRunId: nextStepRun.id,
          },
        },
      }),
      'outbox retry update',
    );
    await requireLeased(
      input.runLease,
      store.appendTimelineIfLeased({
        guard: guardFor(input.runLease),
        event: {
          runId: input.run.id,
          nodeId: input.node.id,
          type: 'OUTBOX_RETRY_SCHEDULED',
          payload: {
            outboxId: input.outbox.id,
            attempt: input.stepRun.attempt,
            nextAttempt,
            availableAt: availableAt.toISOString(),
            message: input.message,
            backoff: input.node.retry?.backoff ?? 'exponential',
          },
        },
      }),
      'outbox retry timeline append',
    );
    return requireLeased(
      input.runLease,
      store.updateRunIfLeased({
        guard: guardFor(input.runLease),
        runId: input.run.id,
        patch: {
          status: 'paused',
          currentNode: input.node.id,
          error: { message: input.message },
        },
      }),
      'outbox retry run pause',
    );
  }

  async function resumeOutboxWaiters(
    outbox: WorkflowOutboxRecord,
    output: Record<string, unknown> | undefined,
  ): Promise<void> {
    for (const waiter of await store.findOutboxWaiters(outbox.id)) {
      const claimed = await claimRunWithLease(waiter.runId);
      if (!claimed) continue;
      try {
        if (
          claimed.run.status !== 'paused' ||
          claimed.run.currentNode !== waiter.nodeId ||
          !stepMatchesRunReplayEpoch(claimed.run, waiter)
        ) {
          continue;
        }
        const workflow = await workflowForRun(claimed.run);
        const waiterNode = workflow.nodes.find(
          (candidate) => candidate.kind === 'step' && candidate.id === waiter.nodeId,
        );
        if (!waiterNode || waiterNode.kind !== 'step') continue;
        await completeStepFromOutput(
          claimed.run,
          waiterNode,
          waiter.id,
          output,
          claimed.lease,
          'queued',
        );
        await requireLeased(
          claimed.lease,
          store.appendTimelineIfLeased({
            guard: guardFor(claimed.lease),
            event: {
              runId: claimed.run.id,
              nodeId: waiterNode.id,
              type: 'OUTBOX_DISPATCHED',
              payload: { outboxId: outbox.id, reused: true },
            },
          }),
          'outbox waiter dispatch timeline append',
        );
      } catch (error) {
        if (!isLeaseLost(error)) throw error;
      } finally {
        await releaseRuntimeLease(claimed.lease);
      }
    }
  }

  async function failOutboxWaiters(outbox: WorkflowOutboxRecord, message: string): Promise<void> {
    for (const waiter of await store.findOutboxWaiters(outbox.id)) {
      const claimed = await claimRunWithLease(waiter.runId);
      if (!claimed) continue;
      try {
        if (
          claimed.run.status !== 'paused' ||
          claimed.run.currentNode !== waiter.nodeId ||
          !stepMatchesRunReplayEpoch(claimed.run, waiter)
        ) {
          continue;
        }
        await requireLeased(
          claimed.lease,
          store.updateStepRunIfLeased({
            guard: guardFor(claimed.lease),
            stepRunId: waiter.id,
            runId: claimed.run.id,
            patch: {
              status: 'failed',
              error: { message },
              completedAt: new Date(),
            },
          }),
          'outbox waiter failure step update',
        );
        await requireLeased(
          claimed.lease,
          store.appendTimelineIfLeased({
            guard: guardFor(claimed.lease),
            event: {
              runId: claimed.run.id,
              nodeId: waiter.nodeId,
              type: 'OUTBOX_DISPATCH_FAILED',
              payload: { outboxId: outbox.id, message, reused: true },
            },
          }),
          'outbox waiter failure timeline append',
        );
        await requireLeased(
          claimed.lease,
          store.updateRunIfLeased({
            guard: guardFor(claimed.lease),
            runId: claimed.run.id,
            patch: {
              status: 'failed',
              currentNode: waiter.nodeId,
              error: { message },
              completedAt: new Date(),
            },
          }),
          'outbox waiter failure run update',
        );
      } catch (error) {
        if (!isLeaseLost(error)) throw error;
      } finally {
        await releaseRuntimeLease(claimed.lease);
      }
    }
  }

  async function reconcilePausedSteps(): Promise<void> {
    const snapshot = await store.snapshot();
    const pausedRuns = snapshot.runs.filter(
      (run) => run.status === 'paused' && run.currentNode !== undefined,
    );
    for (const pausedRun of pausedRuns) {
      if (pausedRun.currentNode === undefined) continue;
      const step = snapshot.steps
        .filter(
          (candidate) =>
            candidate.runId === pausedRun.id &&
            candidate.nodeId === pausedRun.currentNode &&
            stepMatchesRunReplayEpoch(pausedRun, candidate),
        )
        .sort(
          (left, right) =>
            right.createdAt.valueOf() - left.createdAt.valueOf() || right.attempt - left.attempt,
        )[0];
      if (!step || (step.status !== 'completed' && step.status !== 'failed')) continue;
      const claimed = await claimRunWithLease(pausedRun.id);
      if (!claimed) continue;
      try {
        if (claimed.run.status !== 'paused' || claimed.run.currentNode !== step.nodeId) {
          continue;
        }
        const workflow = await workflowForRun(claimed.run);
        const node = workflow.nodes.find(
          (candidate) => candidate.kind === 'step' && candidate.id === step.nodeId,
        );
        if (!node || node.kind !== 'step') continue;
        if (step.status === 'completed') {
          await completeStepFromOutput(
            claimed.run,
            node,
            step.id,
            recordFromUnknown(step.output),
            claimed.lease,
            'queued',
          );
          continue;
        }
        await failStepPermanently(
          claimed.run,
          node,
          step,
          claimed.lease,
          stepErrorMessage(step) ?? 'Paused workflow step failed before run state advanced',
        );
      } catch (error) {
        if (!isLeaseLost(error)) throw error;
      } finally {
        await releaseRuntimeLease(claimed.lease);
      }
    }
  }

  async function failStepPermanently(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
    stepRun: WorkflowStepRunRecord,
    lease: RuntimeLease,
    message: string,
  ): Promise<WorkflowRunRecord> {
    await requireLeased(
      lease,
      store.updateStepRunIfLeased({
        guard: guardFor(lease),
        stepRunId: stepRun.id,
        runId: run.id,
        patch: {
          status: 'failed',
          error: { message },
          completedAt: new Date(),
        },
      }),
      'step permanent failure update',
    );
    await requireLeased(
      lease,
      store.createDeadLetterIfLeased({
        guard: guardFor(lease),
        deadLetter: {
          kind: 'step',
          resourceId: run.id,
          reason: message,
          payload: { node },
        },
      }),
      'step permanent failure dead letter create',
    );
    await requireLeased(
      lease,
      store.appendTimelineIfLeased({
        guard: guardFor(lease),
        event: {
          runId: run.id,
          nodeId: node.id,
          type: 'STEP_FAILED',
          payload: { message },
        },
      }),
      'step permanent failure timeline append',
    );
    return requireLeased(
      lease,
      store.updateRunIfLeased({
        guard: guardFor(lease),
        runId: run.id,
        patch: {
          status: 'failed',
          currentNode: node.id,
          error: { message },
          completedAt: new Date(),
        },
      }),
      'step permanent failure run update',
    );
  }

  async function completeStepFromOutput(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
    stepRunId: string,
    output: Record<string, unknown> | undefined,
    lease: RuntimeLease,
    status: 'running' | 'queued' = 'running',
  ): Promise<WorkflowRunRecord> {
    const nextState = mergeWorkflowState(run.state, output);
    return requireLeased(
      lease,
      store.completeStepAndAdvanceIfLeased({
        guard: guardFor(lease),
        runId: run.id,
        stepRunId,
        stepOutput: output,
        completedAt: new Date(),
        event: {
          runId: run.id,
          nodeId: node.id,
          type: 'STEP_COMPLETED',
          payload: output,
        },
        snapshot: {
          runId: run.id,
          nodeId: node.id,
          state: nextState,
          diff: shallowStateDiff(run.state, nextState),
        },
        runPatch: {
          state: nextState,
          currentNode: await nextNodeId(run, node.id),
          status,
          error: null,
        },
      }),
      'step completion',
    );
  }

  async function advance(
    run: WorkflowRunRecord,
    nodeId: string,
    eventType: string,
    lease: RuntimeLease,
  ): Promise<WorkflowRunRecord> {
    await requireLeased(
      lease,
      store.appendTimelineIfLeased({
        guard: guardFor(lease),
        event: { runId: run.id, nodeId, type: eventType },
      }),
      'advance timeline append',
    );
    return requireLeased(
      lease,
      store.updateRunIfLeased({
        guard: guardFor(lease),
        runId: run.id,
        patch: {
          currentNode: await nextNodeId(run, nodeId),
          status: 'running',
        },
      }),
      'advance run update',
    );
  }

  async function skipApproval(
    run: WorkflowRunRecord,
    approval: WorkflowApprovalIR,
    workflow: WorkflowDefinitionIR,
    lease: RuntimeLease,
  ): Promise<WorkflowRunRecord> {
    try {
      assertApprovalBranchLayout(workflow, approval, 'approve');
    } catch (error) {
      return failApprovalBranchLayout(run, approval.id, lease, error);
    }
    return requireLeased(
      lease,
      store.appendTimelineAndUpdateRunIfLeased({
        guard: guardFor(lease),
        runId: run.id,
        event: { runId: run.id, nodeId: approval.id, type: 'APPROVAL_SKIPPED' },
        patch: {
          currentNode:
            targetNodeId(workflow, approval.onApprove) ?? (await nextNodeId(run, approval.id)),
          status: 'running',
        },
      }),
      'approval skip run update',
    );
  }

  async function failApprovalBranchLayout(
    run: WorkflowRunRecord,
    nodeId: string,
    lease: RuntimeLease,
    error: unknown,
  ): Promise<WorkflowRunRecord> {
    const message = error instanceof Error ? error.message : String(error);
    return requireLeased(
      lease,
      store.updateRunIfLeased({
        guard: guardFor(lease),
        runId: run.id,
        patch: {
          status: 'failed',
          currentNode: nodeId,
          error: { message },
          completedAt: new Date(),
        },
      }),
      'approval branch-layout failure',
    );
  }

  async function nextNodeId(run: WorkflowRunRecord, nodeId: string): Promise<string | undefined> {
    const workflow = await workflowForRun(run);
    const graph = graphForWorkflow(workflow);
    if (!graph.hasApprovals) return graph.nextNodeById.get(nodeId);
    const index = graph.nodeIndexById.get(nodeId) ?? -1;
    const skippedTargets = await approvalSkippedTargetsForRun(run, workflow);
    for (const candidate of workflow.nodes.slice(index + 1)) {
      if (skippedTargets.has(candidate.id)) continue;
      return candidate.id;
    }
    return undefined;
  }

  function targetNodeId(
    workflow: WorkflowDefinitionIR,
    target: string | undefined,
  ): string | undefined {
    if (!target) return undefined;
    const graph = graphForWorkflow(workflow);
    return graph.nodeById.has(target) ? target : graph.nodeIdByName.get(target);
  }

  function unsafeExternalNodesFrom(
    workflow: WorkflowDefinitionIR,
    nodeId: string | undefined,
    state: Record<string, unknown>,
  ): readonly WorkflowStepIR[] {
    const startIndex =
      nodeId === undefined
        ? 0
        : Math.max(
            0,
            workflow.nodes.findIndex((node) => node.id === nodeId),
          );
    const skippedTargets = approvalSkippedTargetsForReplayNode(workflow, nodeId);
    return workflow.nodes
      .slice(startIndex)
      .filter((node) => !skippedTargets.has(node.id))
      .filter(
        (node): node is WorkflowStepIR =>
          node.kind === 'step' &&
          node.sideEffects === 'external' &&
          !hasResolvableIdempotencyKey(node, state),
      );
  }

  function hasResolvableIdempotencyKey(
    node: WorkflowStepIR,
    state: Record<string, unknown>,
  ): boolean {
    try {
      return resolveExternalIdempotencyKey(node, state) !== undefined;
    } catch {
      return false;
    }
  }

  function resolveExternalIdempotencyKey(
    node: WorkflowStepIR,
    state: Record<string, unknown>,
  ): string | undefined {
    if (node.idempotency === undefined) return undefined;
    const value = getPath({ state }, node.idempotency);
    if (value === undefined || value === null || value === '') {
      throw new Error(
        `External step "${node.name}" idempotency expression "${node.idempotency}" resolved to an empty value.`,
      );
    }
    if (typeof value === 'object') {
      throw new Error(
        `External step "${node.name}" idempotency expression "${node.idempotency}" must resolve to a scalar value.`,
      );
    }
    return String(value);
  }

  async function approvalSkippedTargetsForRun(
    run: WorkflowRunRecord,
    workflow: WorkflowDefinitionIR,
  ): Promise<ReadonlySet<string>> {
    if (!graphForWorkflow(workflow).hasApprovals) return new Set();
    const inspection = await store.inspectRun({ runId: run.id, include: { timeline: true } });
    const timeline = inspection?.timeline ?? [];
    const latestReplayResume = [...timeline]
      .reverse()
      .find((event) => event.type === 'RUN_REPLAY_RESUMED');
    const latestReplayMarkerId = stringFromUnknown(
      recordFromUnknown(latestReplayResume?.payload)[WORKFLOW_REPLAY_EPOCH_KEY] ??
        recordFromUnknown(latestReplayResume?.payload)['replayMarkerId'],
    );
    const skipped = new Set<string>();
    for (const event of timeline) {
      if (latestReplayResume && event.sequence <= latestReplayResume.sequence) {
        const eventPayload = recordFromUnknown(event.payload);
        const isReplayMarker =
          eventPayload['replay'] === true &&
          stringFromUnknown(eventPayload['replayMarkerId']) === latestReplayMarkerId;
        if (!isReplayMarker) continue;
      }
      const outcome = approvalOutcomeFromEvent(event.type);
      if (!outcome || event.nodeId === undefined) continue;
      const approval = workflow.nodes.find(
        (node): node is WorkflowApprovalIR => node.kind === 'approval' && node.id === event.nodeId,
      );
      if (!approval) continue;
      const ranges = approvalOutcomeRanges(workflow, approval);
      assertApprovalBranchLayout(workflow, approval, outcome === 'skipped' ? 'approve' : outcome);
      const selected = selectedApprovalOutcomeRange(
        ranges,
        outcome === 'skipped' ? 'approve' : outcome,
      );
      for (const range of ranges) {
        if (selected && range.outcome === selected.outcome) continue;
        for (let index = range.startIndex; index < range.endIndex; index += 1) {
          const node = workflow.nodes[index];
          if (node) skipped.add(node.id);
        }
      }
    }
    return skipped;
  }

  async function appendReplayBranchOutcome(input: {
    readonly runId: string;
    readonly workflow: WorkflowDefinitionIR;
    readonly fromNodeId: string | undefined;
    readonly originalRunId: string;
    readonly mode: WorkflowReplayMode;
    readonly replayMarkerId: string;
  }): Promise<void> {
    const replayBranch = approvalOutcomeForReplayNode(input.workflow, input.fromNodeId);
    if (!replayBranch) return;
    await store.appendTimeline({
      runId: input.runId,
      nodeId: replayBranch.approval.id,
      type: approvalOutcomeTimelineEventType(replayBranch.outcome),
      payload: {
        replay: true,
        replayMarkerId: input.replayMarkerId,
        originalRunId: input.originalRunId,
        mode: input.mode,
        fromNodeId: input.fromNodeId,
      },
    });
  }

  async function appendReplayBranchOutcomeIfLeased(input: {
    readonly runId: string;
    readonly workflow: WorkflowDefinitionIR;
    readonly fromNodeId: string | undefined;
    readonly originalRunId: string;
    readonly mode: WorkflowReplayMode;
    readonly replayMarkerId: string;
    readonly lease: RuntimeLease;
  }): Promise<void> {
    const replayBranch = approvalOutcomeForReplayNode(input.workflow, input.fromNodeId);
    if (!replayBranch) return;
    await requireLeased(
      input.lease,
      store.appendTimelineIfLeased({
        guard: guardFor(input.lease),
        event: {
          runId: input.runId,
          nodeId: replayBranch.approval.id,
          type: approvalOutcomeTimelineEventType(replayBranch.outcome),
          payload: {
            replay: true,
            replayMarkerId: input.replayMarkerId,
            originalRunId: input.originalRunId,
            mode: input.mode,
            fromNodeId: input.fromNodeId,
          },
        },
      }),
      'replay branch outcome timeline append',
    );
  }

  function assertApprovalBranchLayout(
    workflow: WorkflowDefinitionIR,
    approval: WorkflowApprovalIR,
    selectedOutcome: ApprovalOutcome,
  ): void {
    const ranges = approvalOutcomeRanges(workflow, approval);
    const selected = selectedApprovalOutcomeRange(ranges, selectedOutcome);
    const unselected = ranges.filter((range) => !selected || range.outcome !== selected.outcome);
    const lastRange = ranges[ranges.length - 1];
    const guessesUnboundedTail = unselected.some(
      (range) => lastRange !== undefined && range.startIndex === lastRange.startIndex,
    );
    if (
      unselected.length > 0 &&
      (ranges.length < 2 || (guessesUnboundedTail && !hasProvenEqualBranchSpans(ranges)))
    ) {
      throw new Error(
        `Approval "${approval.name}" has an ambiguous branch layout. Add explicit bounded outcome targets, or make the unchosen branch terminal.`,
      );
    }
  }

  function hasProvenEqualBranchSpans(
    ranges: readonly { readonly startIndex: number; readonly endIndex: number }[],
  ): boolean {
    if (ranges.length < 3) return false;
    const spans: number[] = [];
    for (let index = 0; index < ranges.length - 1; index += 1) {
      const range = ranges[index];
      const next = ranges[index + 1];
      if (!range || !next) continue;
      spans.push(next.startIndex - range.startIndex);
    }
    const first = spans[0];
    return first !== undefined && spans.length >= 2 && spans.every((span) => span === first);
  }

  function selectedApprovalOutcomeRange(
    ranges: readonly ApprovalOutcomeRange[],
    selectedOutcome: ApprovalOutcome,
  ): ApprovalOutcomeRange | undefined {
    return ranges.find((range) => range.outcome === selectedOutcome);
  }

  function approvalOutcomeForReplayNode(
    workflow: WorkflowDefinitionIR,
    nodeId: string | undefined,
  ):
    | {
        readonly approval: WorkflowApprovalIR;
        readonly outcome: 'approve' | 'reject' | 'timeout';
      }
    | undefined {
    if (nodeId === undefined) return undefined;
    const nodeIndex = workflow.nodes.findIndex((node) => node.id === nodeId);
    if (nodeIndex < 0) return undefined;
    for (const approval of workflow.nodes) {
      if (approval.kind !== 'approval') continue;
      const ranges = approvalOutcomeRanges(workflow, approval);
      const range = ranges.find(
        (candidate) => nodeIndex >= candidate.startIndex && nodeIndex < candidate.endIndex,
      );
      if (!range) continue;
      assertApprovalBranchLayout(workflow, approval, range.outcome);
      return { approval, outcome: range.outcome };
    }
    return undefined;
  }

  function approvalSkippedTargetsForReplayNode(
    workflow: WorkflowDefinitionIR,
    nodeId: string | undefined,
  ): ReadonlySet<string> {
    const replayBranch = approvalOutcomeForReplayNode(workflow, nodeId);
    if (!replayBranch) return new Set();
    const skipped = new Set<string>();
    const ranges = approvalOutcomeRanges(workflow, replayBranch.approval);
    for (const range of ranges) {
      if (range.outcome === replayBranch.outcome) continue;
      for (let index = range.startIndex; index < range.endIndex; index += 1) {
        const node = workflow.nodes[index];
        if (node) skipped.add(node.id);
      }
    }
    return skipped;
  }

  function approvalOutcomeRanges(
    workflow: WorkflowDefinitionIR,
    approval: WorkflowApprovalIR,
  ): readonly ApprovalOutcomeRange[] {
    const targets = approvalOutcomeTargets(workflow, approval);
    const ranges = [
      outcomeRangeStart(workflow, 'approve', targets.approve),
      outcomeRangeStart(workflow, 'reject', targets.reject),
      outcomeRangeStart(workflow, 'timeout', targets.timeout),
    ].filter((range) => range !== undefined);
    const uniqueRanges = new Map<
      number,
      { readonly outcome: ApprovalOutcome; readonly startIndex: number }
    >();
    for (const range of ranges) {
      if (!uniqueRanges.has(range.startIndex)) uniqueRanges.set(range.startIndex, range);
    }
    const sorted = [...uniqueRanges.values()].sort(
      (left, right) => left.startIndex - right.startIndex,
    );
    if (sorted.length === 0) return [];
    const observedSpans: number[] = [];
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const range = sorted[index];
      const next = sorted[index + 1];
      if (!range || !next) continue;
      const span = next.startIndex - range.startIndex;
      if (span > 0) observedSpans.push(span);
    }
    const fallbackSpan = Math.max(1, Math.min(...(observedSpans.length ? observedSpans : [1])));
    return sorted.map((range, index) => {
      const next = sorted[index + 1];
      return {
        outcome: range.outcome,
        startIndex: range.startIndex,
        endIndex: Math.min(
          workflow.nodes.length,
          next?.startIndex ?? range.startIndex + fallbackSpan,
        ),
      };
    });
  }

  function outcomeRangeStart(
    workflow: WorkflowDefinitionIR,
    outcome: ApprovalOutcome,
    target: string | undefined,
  ): { readonly outcome: ApprovalOutcome; readonly startIndex: number } | undefined {
    if (!target) return undefined;
    const startIndex = workflow.nodes.findIndex((node) => node.id === target);
    return startIndex >= 0 ? { outcome, startIndex } : undefined;
  }

  function approvalOutcomeTargets(
    workflow: WorkflowDefinitionIR,
    approval: WorkflowApprovalIR,
  ): {
    readonly approve?: string;
    readonly reject?: string;
    readonly timeout?: string;
  } {
    const targets: {
      approve?: string;
      reject?: string;
      timeout?: string;
    } = {};
    const approve = targetNodeId(workflow, approval.onApprove);
    const reject = targetNodeId(workflow, approval.onReject);
    const timeout = targetNodeId(workflow, approval.onTimeout);
    if (approve !== undefined) targets.approve = approve;
    if (reject !== undefined) targets.reject = reject;
    if (timeout !== undefined) targets.timeout = timeout;
    return targets;
  }

  function approvalOutcomeFromEvent(eventType: string): ApprovalTimelineOutcome | undefined {
    switch (eventType) {
      case 'APPROVAL_APPROVED':
        return 'approve';
      case 'APPROVAL_REJECTED':
        return 'reject';
      case 'APPROVAL_TIMED_OUT':
        return 'timeout';
      case 'APPROVAL_SKIPPED':
        return 'skipped';
      default:
        return undefined;
    }
  }

  function approvalOutcomeTimelineEventType(
    outcome: 'approve' | 'reject' | 'timeout',
  ): 'APPROVAL_APPROVED' | 'APPROVAL_REJECTED' | 'APPROVAL_TIMED_OUT' {
    switch (outcome) {
      case 'approve':
        return 'APPROVAL_APPROVED';
      case 'reject':
        return 'APPROVAL_REJECTED';
      case 'timeout':
        return 'APPROVAL_TIMED_OUT';
    }
  }

  function isTerminalRunStatus(status: WorkflowRunRecord['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }

  function outboxErrorMessage(outbox: WorkflowOutboxRecord): string | undefined {
    const error = recordFromUnknown(outbox.error);
    return stringFromUnknown(error['message']);
  }

  function runErrorMessage(run: WorkflowRunRecord): string | undefined {
    const error = recordFromUnknown(run.error);
    return stringFromUnknown(error['message']);
  }

  function stepErrorMessage(step: WorkflowStepRunRecord): string | undefined {
    const error = recordFromUnknown(step.error);
    return stringFromUnknown(error['message']);
  }

  async function workflowForRun(run: WorkflowRunRecord): Promise<WorkflowDefinitionIR> {
    const cached = workflowByVersionId.get(run.versionId);
    if (cached) return cached;
    const version = await store.findWorkflowVersion(run.versionId);
    const workflow =
      version?.compiledGraph ??
      options.manifest.workflows.find((candidate) => candidate.id === run.workflowId);
    if (!workflow) throw new Error(`Workflow definition not found for run ${run.id}`);
    workflowByVersionId.set(run.versionId, workflow);
    workflowByName.set(workflow.name, workflow);
    return workflow;
  }

  async function nextStepAttempt(run: WorkflowRunRecord, nodeId: string): Promise<number> {
    const inspection = await store.inspectRun({ runId: run.id, include: { steps: true } });
    const attempts = (inspection?.steps ?? [])
      .filter((step) => step.nodeId === nodeId)
      .map((step) => step.attempt);
    return Math.max(0, ...attempts) + 1;
  }

  async function currentEpochStepAttemptCount(
    run: WorkflowRunRecord,
    nodeId: string,
  ): Promise<number> {
    const inspection = await store.inspectRun({ runId: run.id, include: { steps: true } });
    return (inspection?.steps ?? []).filter(
      (step) => step.nodeId === nodeId && stepMatchesRunReplayEpoch(run, step),
    ).length;
  }

  async function prepareStepExecution(
    run: WorkflowRunRecord,
    node: WorkflowStepIR,
    lease: RuntimeLease,
  ): Promise<
    | { readonly kind: 'execute'; readonly attempt: number }
    | { readonly kind: 'restored'; readonly run: WorkflowRunRecord }
  > {
    const inspection = await store.inspectRun({ runId: run.id, include: { steps: true } });
    const steps = inspection?.steps ?? [];
    const completed = steps
      .filter(
        (step) =>
          step.runId === run.id &&
          step.nodeId === node.id &&
          step.status === 'completed' &&
          stepMatchesRunReplayEpoch(run, step),
      )
      .sort((left, right) => right.attempt - left.attempt)[0];
    if (!completed) {
      const attempts = steps
        .filter((step) => step.runId === run.id && step.nodeId === node.id)
        .map((step) => step.attempt);
      return { kind: 'execute', attempt: Math.max(0, ...attempts) + 1 };
    }
    const outputRecord = recordFromUnknown(completed.output);
    const restoredState = mergeWorkflowState(run.state, outputRecord);
    await requireLeased(
      lease,
      store.appendTimelineIfLeased({
        guard: guardFor(lease),
        event: {
          runId: run.id,
          nodeId: node.id,
          type: 'STEP_RESTORED',
          payload: { attempt: completed.attempt },
        },
      }),
      'restored step timeline append',
    );
    return {
      kind: 'restored',
      run: await requireLeased(
        lease,
        store.updateRunIfLeased({
          guard: guardFor(lease),
          runId: run.id,
          patch: {
            state: restoredState,
            currentNode: await nextNodeId(run, node.id),
            status: 'running',
          },
        }),
        'restored step run update',
      ),
    };
  }

  async function replayStateForNode(
    run: WorkflowRunRecord,
    nodeId: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (nodeId === undefined) return seedState(run.input);
    const workflow = await workflowForRun(run);
    if (workflow.nodes[0]?.id === nodeId) return seedState(run.input);
    const inspection = await store.inspectRun({
      runId: run.id,
      include: { steps: true, stateSnapshots: true, approvals: true },
    });
    const stepInput = (inspection?.steps ?? [])
      .filter(
        (step) =>
          step.nodeId === nodeId &&
          step.input !== undefined &&
          stepMatchesRunReplayEpoch(run, step),
      )
      .sort((left, right) => left.attempt - right.attempt)[0]?.input;
    if (stepInput !== undefined) return recordFromUnknown(stepInput);
    const approvalState = (inspection?.approvals ?? [])
      .filter(
        (approval) => approval.nodeId === nodeId && approvalMatchesRunReplayEpoch(run, approval),
      )
      .sort((left, right) => right.requestedAt.valueOf() - left.requestedAt.valueOf())
      .map((approval) => payloadStateFromUnknown(approval.payload))
      .find((state) => state !== undefined);
    if (approvalState !== undefined) return approvalState;
    const storeSnapshot = await store.snapshot();
    const timerState = storeSnapshot.timers
      .filter((timer) => timer.runId === run.id && timer.nodeId === nodeId)
      .filter((timer) => timerMatchesRunReplayEpoch(run, timer))
      .sort(
        (left, right) =>
          new Date(String(right.createdAt)).valueOf() - new Date(String(left.createdAt)).valueOf(),
      )
      .map((timer) => payloadStateFromUnknown(timer.payload))
      .find((state) => state !== undefined);
    if (timerState !== undefined) return timerState;
    const snapshot = (inspection?.stateSnapshots ?? [])
      .filter((entry) => entry.nodeId === nodeId && stateMatchesRunReplayEpoch(run, entry.state))
      .sort((left, right) => left.sequence - right.sequence)[0];
    if (snapshot) return snapshot.state;
    throw new Error(
      `Workflow replay state not found for node ${nodeId}. Replay from a step, timer, or approval reached in the current replay epoch, or replay from the first workflow node.`,
    );
  }

  async function requireWorkflow(name: string): Promise<WorkflowDefinitionIR> {
    const cached = workflowByName.get(name);
    if (cached) return cached;
    const workflow = await store.findWorkflowByName(name);
    if (!workflow) throw new Error(`Workflow not found: ${name}`);
    workflowByName.set(name, workflow);
    workflowByVersionId.set(workflowVersionId(workflow), workflow);
    return workflow;
  }

  function graphForWorkflow(workflow: WorkflowDefinitionIR): WorkflowGraphIndex {
    const versionId = workflowVersionId(workflow);
    const cached = workflowGraphByVersionId.get(versionId);
    if (cached) return cached;
    const nodeById = new Map<string, WorkflowExecutionNodeIR>();
    const nodeIdByName = new Map<string, string>();
    const nodeIndexById = new Map<string, number>();
    const nextNodeById = new Map<string, string | undefined>();
    let hasApprovals = false;
    for (let index = 0; index < workflow.nodes.length; index += 1) {
      const node = workflow.nodes[index];
      if (!node) continue;
      nodeById.set(node.id, node);
      if (!nodeIdByName.has(node.name)) nodeIdByName.set(node.name, node.id);
      nodeIndexById.set(node.id, index);
      nextNodeById.set(node.id, workflow.nodes[index + 1]?.id);
      hasApprovals = hasApprovals || node.kind === 'approval';
    }
    const graph = { nodeById, nodeIdByName, nodeIndexById, nextNodeById, hasApprovals };
    workflowGraphByVersionId.set(versionId, graph);
    return graph;
  }

  async function requireRun(runId: string): Promise<WorkflowRunRecord> {
    const run = await store.findRun(runId);
    if (!run) throw new Error(`Workflow run not found: ${runId}`);
    return run;
  }

  async function withLeaseHeartbeat<T>(
    leases: RuntimeLease | readonly RuntimeLease[],
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const activeLeases = Array.isArray(leases) ? leases : [leases];
    let heartbeatError: unknown;
    const heartbeat = async () => {
      for (const lease of activeLeases) {
        const extended = await store.extendLease({
          leaseId: lease.leaseId,
          resourceType: lease.resourceType,
          resourceId: lease.resourceId,
          workerId: lease.workerId,
          ttlMs: lease.ttlMs,
        });
        if (!extended) {
          throw new WorkflowLeaseLostError(
            `Workflow ${lease.resourceType} lease lost for ${lease.resourceId}; aborting execution.`,
          );
        }
      }
    };
    const value = operation();
    if (!isPromiseLike(value)) return value;
    const interval = setInterval(
      () => {
        void heartbeat().catch((error: unknown) => {
          heartbeatError = error;
        });
      },
      Math.max(10, Math.min(...activeLeases.map((lease) => Math.floor(lease.ttlMs / 3)))),
    );
    try {
      const result = await value;
      if (heartbeatError) throw heartbeatError;
      return result;
    } finally {
      clearInterval(interval);
    }
  }

  return {
    manifest: options.manifest,
    store,
    enqueue,
    ingest,
    runNext,
    runUntilIdle,
    approve,
    reject,
    cancel,
    pause,
    resume,
    replay,
    resumeDueTimers,
    expireDueApprovals,
    pendingApprovals: async () => {
      await ensureReady();
      return store.pendingApprovals();
    },
    dispatchNextOutbox,
    inspect: async (runId, include) => {
      await ensureReady();
      const inspection = await store.inspectRun({
        runId,
        ...(include !== undefined ? { include } : {}),
      });
      if (!inspection) return undefined;
      return {
        ...inspection.run,
        ...(inspection.steps !== undefined ? { steps: inspection.steps } : {}),
        ...(inspection.timeline !== undefined ? { timeline: inspection.timeline } : {}),
        ...(inspection.stateSnapshots !== undefined
          ? { stateSnapshots: inspection.stateSnapshots }
          : {}),
        ...(inspection.approvals !== undefined ? { approvals: inspection.approvals } : {}),
        ...(inspection.outbox !== undefined ? { outbox: inspection.outbox } : {}),
        ...(inspection.deadLetters !== undefined ? { deadLetters: inspection.deadLetters } : {}),
      };
    },
    snapshot: async () => {
      await ensureReady();
      return store.snapshot();
    },
  };
}

function readyForDefinitions(
  store: WorkflowStore,
  workflows: readonly WorkflowDefinitionIR[],
): Promise<void> {
  const key = workflows
    .map((workflow) => `${workflow.id}:${workflowVersionId(workflow)}`)
    .sort()
    .join('|');
  let readyByKey = definitionReadyByStore.get(store);
  if (!readyByKey) {
    readyByKey = new Map();
    definitionReadyByStore.set(store, readyByKey);
  }
  const existing = readyByKey.get(key);
  if (existing) return existing;
  const ready = store.upsertDefinitions(workflows);
  readyByKey.set(key, ready);
  return ready;
}

function indexWorkflowsByTrigger(
  workflows: readonly WorkflowDefinitionIR[],
): Map<string, readonly WorkflowDefinitionIR[]> {
  const index = new Map<string, WorkflowDefinitionIR[]>();
  for (const workflow of workflows) {
    for (const trigger of workflow.triggers) {
      const key = triggerKey(trigger.source, trigger.event);
      const matches = index.get(key);
      if (matches) {
        matches.push(workflow);
      } else {
        index.set(key, [workflow]);
      }
    }
  }
  return index;
}

function triggerKey(source: string, eventType: string): string {
  return `${source}\u0000${eventType}`;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    value !== null && (typeof value === 'object' || typeof value === 'function') && 'then' in value
  );
}

function seedState(input: unknown): Record<string, unknown> {
  return sanitizedUserState(
    input && typeof input === 'object' && !Array.isArray(input) ? input : { input },
  );
}

function stateWithNewReplayEpoch(
  state: Record<string, unknown>,
  replayEpoch = randomUUID(),
): Record<string, unknown> {
  return {
    ...sanitizedUserState(state),
    [WORKFLOW_INTERNAL_STATE_KEY]: {
      [WORKFLOW_REPLAY_EPOCH_KEY]: replayEpoch,
    },
  };
}

function mergeWorkflowState(
  base: Record<string, unknown>,
  output: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const internalState = base[WORKFLOW_INTERNAL_STATE_KEY];
  const nextState = {
    ...base,
    ...sanitizedUserState(output ?? {}),
  };
  if (internalState !== undefined) {
    nextState[WORKFLOW_INTERNAL_STATE_KEY] = internalState;
  } else {
    delete nextState[WORKFLOW_INTERNAL_STATE_KEY];
  }
  return nextState;
}

function handlerStateFrom(state: Record<string, unknown>): Record<string, unknown> {
  return deepClone(sanitizedUserState(state));
}

function sanitizedUserState(value: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(recordFromUnknown(value)).filter(([key]) => key !== WORKFLOW_INTERNAL_STATE_KEY),
  );
}

function replayEpochForState(state: Record<string, unknown>): string | undefined {
  return stringFromUnknown(
    recordFromUnknown(state[WORKFLOW_INTERNAL_STATE_KEY])[WORKFLOW_REPLAY_EPOCH_KEY],
  );
}

function stateMatchesRunReplayEpoch(
  run: WorkflowRunRecord,
  state: Record<string, unknown>,
): boolean {
  const runEpoch = replayEpochForState(run.state);
  const recordEpoch = replayEpochForState(state);
  return runEpoch === undefined ? recordEpoch === undefined : recordEpoch === runEpoch;
}

function payloadStateFromUnknown(value: unknown): Record<string, unknown> | undefined {
  const payload = recordFromUnknown(value);
  return Object.hasOwn(payload, 'state') ? recordFromUnknown(payload['state']) : undefined;
}

function shallowStateDiff(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, { readonly before?: unknown; readonly after?: unknown }> {
  const out: Record<string, { readonly before?: unknown; readonly after?: unknown }> = {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    const before = previous[key];
    const after = next[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      out[key] = {
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
      };
    }
  }
  return out;
}

function approvalMatchesRunReplayEpoch(
  run: WorkflowRunRecord,
  approval: WorkflowApprovalRecord,
): boolean {
  return stateMatchesRunReplayEpoch(
    run,
    recordFromUnknown(recordFromUnknown(approval.payload)['state']),
  );
}

function stepMatchesRunReplayEpoch(run: WorkflowRunRecord, step: WorkflowStepRunRecord): boolean {
  return stateMatchesRunReplayEpoch(run, recordFromUnknown(step.input));
}

function timerMatchesRunReplayEpoch(
  run: WorkflowRunRecord,
  timer: { readonly payload?: unknown },
): boolean {
  return stateMatchesRunReplayEpoch(
    run,
    recordFromUnknown(recordFromUnknown(timer.payload)['state']),
  );
}

function outboxMatchesRunReplayEpoch(
  run: WorkflowRunRecord,
  outbox: WorkflowOutboxRecord,
): boolean {
  return stateMatchesRunReplayEpoch(
    run,
    recordFromUnknown(recordFromUnknown(outbox.payload)['state']),
  );
}

function dedupeKeyFor(
  workflow: WorkflowDefinitionIR | undefined,
  input: WorkflowIngestInput,
): string {
  const trigger = workflow?.triggers.find(
    (candidate) => candidate.source === input.source && candidate.event === input.eventType,
  );
  const raw = getPath({ event: input.payload }, trigger?.dedupeBy);
  return canonicalDedupeKey(
    input,
    String(raw ?? input.externalId ?? JSON.stringify(input.payload)),
  );
}

function dedupeKeyForMatches(
  workflows: readonly WorkflowDefinitionIR[],
  input: WorkflowIngestInput,
): string {
  if (input.dedupeKey !== undefined) {
    return canonicalDedupeKey(input, input.dedupeKey);
  }
  if (workflows.length === 0) {
    return dedupeKeyFor(undefined, input);
  }
  const expressions = workflows.map((workflow) => triggerDedupeExpressionFor(workflow, input));
  if (new Set(expressions).size > 1) {
    throw new Error(
      `Workflow ingest matched workflows with incompatible dedupeBy expressions for ${input.source}:${input.eventType}. Add an explicit dedupeKey or align trigger dedupeBy expressions.`,
    );
  }
  const keys = workflows.map((workflow) => dedupeKeyFor(workflow, input));
  const uniqueKeys = new Set(keys);
  if (uniqueKeys.size > 1) {
    throw new Error(
      `Workflow ingest matched workflows with incompatible dedupe keys for ${input.source}:${input.eventType}. Add an explicit dedupeKey or align trigger dedupeBy expressions.`,
    );
  }
  return keys[0] ?? dedupeKeyFor(undefined, input);
}

function triggerDedupeExpressionFor(
  workflow: WorkflowDefinitionIR,
  input: WorkflowIngestInput,
): string {
  return (
    workflow.triggers.find(
      (candidate) => candidate.source === input.source && candidate.event === input.eventType,
    )?.dedupeBy ?? '<default>'
  );
}

function canonicalDedupeKey(input: WorkflowIngestInput, raw: string): string {
  return `${input.source}:${input.connectorAccountId ?? 'default'}:${input.eventType}:${raw}`;
}

function resolveTimerResumeAt(resumeAt: string | undefined, delay: string | undefined): Date {
  if (resumeAt) {
    const parsed = new Date(resumeAt);
    if (!Number.isNaN(parsed.valueOf())) return parsed;
  }
  return new Date(Date.now() + parseDurationMs(delay ?? '1s'));
}

function parseDurationMs(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/);
  if (!match) return 1000;
  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  switch (unit) {
    case 'd':
      return amount * 86_400_000;
    case 'h':
      return amount * 3_600_000;
    case 'm':
      return amount * 60_000;
    case 's':
      return amount * 1000;
    case 'ms':
      return amount;
  }
  return amount;
}

function retryDelayMs(backoff: 'fixed' | 'exponential' | undefined, attempt: number): number {
  const baseMs = 10;
  if (backoff === 'fixed') return baseMs;
  return baseMs * 2 ** Math.max(0, attempt - 2);
}

function resolveTimeoutAt(timeout: string): Date {
  return new Date(Date.now() + parseDurationMs(timeout));
}

export function createWorkflowClient(runtime: WorkflowRuntime): WorkflowClient {
  return {
    enqueue: runtime.enqueue,
    ingest: runtime.ingest,
    replay: runtime.replay,
    cancel: runtime.cancel,
    pause: runtime.pause,
    resume: runtime.resume,
    approve: runtime.approve,
    reject: runtime.reject,
    run: {
      findUnique: async ({ where, include }) => {
        return runtime.inspect(where.id, include);
      },
      findMany: async () => (await runtime.snapshot()).runs,
    },
    step: {
      findMany: async (input) => {
        const steps = (await runtime.snapshot()).steps;
        const runId = input?.where?.runId;
        return runId ? steps.filter((step) => step.runId === runId) : steps;
      },
    },
    deadLetter: {
      findMany: async () => (await runtime.snapshot()).deadLetters,
    },
  };
}

export function createWorkflowHttpApp(options: CreateWorkflowHttpAppOptions): WorkflowHttpApp {
  const runtime = options.runtime ?? createWorkflowRuntime(options);
  return {
    manifest: options.manifest,
    fetch: async (request: Request) => {
      try {
        const url = new URL(request.url);
        const segments = url.pathname.split('/').filter(Boolean);
        const routeIndex = segments.indexOf('prisma-workflows');
        const route = routeIndex >= 0 ? segments.slice(routeIndex + 1) : segments;
        const [action, first, second] = route;

        if (request.method === 'GET' && (action === undefined || action === 'health')) {
          return jsonResponse({ ok: true, workflows: options.manifest.workflows.length });
        }

        if (request.method === 'GET' && action === 'studio') {
          return jsonResponse(await workflowRuntimeSnapshotResponse(runtime));
        }

        if (request.method === 'GET' && action === 'inspect' && first) {
          const run = await runtime.inspect(first, includeFromSearchParams(url.searchParams));
          return run
            ? jsonResponse({ run })
            : jsonResponse({ error: 'Workflow run not found' }, 404);
        }

        if (request.method === 'POST' && action === 'ingest' && first) {
          const rawBody = await request.text();
          const body = recordFromUnknown(parseJsonBody(rawBody));
          const eventType = stringFromUnknown(body['eventType'] ?? body['type']);
          if (!eventType) {
            return jsonResponse({ error: 'Missing JSON field `eventType` or `type`' }, 400);
          }
          const payload = body['payload'] ?? body['event'] ?? body;
          const occurredAt = dateFromUnknown(body['occurredAt']);
          const externalId = stringFromUnknown(body['externalId']);
          const headers = Object.fromEntries(request.headers.entries());
          const connector = options.connectors?.[first];
          const eventDefinition = connector?.events?.[eventType];
          let ingestPayload: unknown = payload;
          let normalizedPayload: unknown = payload;
          let connectorDedupeKey: string | undefined;
          let connectorExternalId = externalId;
          let connectorOccurredAt = occurredAt;
          let signatureVerified = false;
          if (eventDefinition) {
            const context = {
              rawBody,
              headers,
              event: payload,
              ...(second !== undefined ? { account: { id: second } } : {}),
              secrets: options.secrets ?? {},
            };
            signatureVerified = eventDefinition.verify
              ? await eventDefinition.verify(context)
              : false;
            if (eventDefinition.verify && !signatureVerified) {
              return jsonResponse({ error: 'Invalid workflow connector signature' }, 401);
            }
            connectorDedupeKey = await eventDefinition.dedupeKey(context);
            const normalized = await eventDefinition.normalize(context);
            ingestPayload = normalized.payload;
            normalizedPayload = normalized.payload;
            connectorExternalId = normalized.externalId;
            connectorOccurredAt = normalized.occurredAt;
          }
          const result = await runtime.ingest({
            source: first,
            eventType,
            payload: ingestPayload,
            rawPayload: { rawBody, parsedBody: body },
            normalizedPayload,
            ...(second !== undefined ? { connectorAccountId: second } : {}),
            ...(connectorDedupeKey !== undefined ? { dedupeKey: connectorDedupeKey } : {}),
            ...(connectorExternalId !== undefined ? { externalId: connectorExternalId } : {}),
            headers,
            signatureVerified,
            ...(connectorOccurredAt !== undefined ? { occurredAt: connectorOccurredAt } : {}),
          });
          return jsonResponse(result, result.duplicate ? 200 : 202);
        }

        if (request.method === 'POST' && action === 'run') {
          return jsonResponse({ processedRuns: await runtime.runUntilIdle() });
        }

        if (request.method === 'POST' && action === 'approve' && first) {
          const body = recordFromUnknown(await readRequestJson(request));
          const approvedBy = stringFromUnknown(body['approvedBy']);
          if (!approvedBy) {
            return jsonResponse({ error: 'Missing JSON field `approvedBy`' }, 400);
          }
          const reason = stringFromUnknown(body['reason']);
          return jsonResponse({
            run: await runtime.approve(first, {
              approvedBy,
              ...(reason !== undefined ? { reason } : {}),
              ...(body['decision'] !== undefined ? { decision: body['decision'] } : {}),
            }),
          });
        }

        if (request.method === 'POST' && action === 'reject' && first) {
          const body = recordFromUnknown(await readRequestJson(request));
          const rejectedBy = stringFromUnknown(body['rejectedBy']);
          if (!rejectedBy) {
            return jsonResponse({ error: 'Missing JSON field `rejectedBy`' }, 400);
          }
          const reason = stringFromUnknown(body['reason']);
          return jsonResponse({
            run: await runtime.reject(first, {
              rejectedBy,
              ...(reason !== undefined ? { reason } : {}),
              ...(body['decision'] !== undefined ? { decision: body['decision'] } : {}),
            }),
          });
        }

        if (request.method === 'POST' && action === 'replay' && first) {
          const body = recordFromUnknown(await readRequestJson(request));
          const mode = workflowReplayModeFromUnknown(body['mode']);
          const fromStep = stringFromUnknown(body['fromStep']);
          const run = await runtime.replay(first, {
            ...(fromStep !== undefined ? { fromStep } : {}),
            ...(mode !== undefined ? { mode } : {}),
            ...(typeof body['confirmSideEffects'] === 'boolean'
              ? { confirmSideEffects: body['confirmSideEffects'] }
              : {}),
          });
          return jsonResponse({
            run,
            processedRuns: await runtime.runUntilIdle(),
          });
        }

        return jsonResponse({ error: 'Workflow route not found' }, 404);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: message }, 500);
      }
    },
  };
}

async function workflowRuntimeSnapshotResponse(runtime: WorkflowRuntime): Promise<unknown> {
  const snapshot = await runtime.snapshot();
  return {
    kind: 'prisma-workflow-runtime-snapshot',
    version: 1,
    manifest: runtime.manifest,
    datasets: {
      ingestEvents: snapshot.ingestEvents,
      runs: snapshot.runs,
      steps: snapshot.steps,
      timeline: snapshot.timeline,
      stateSnapshots: snapshot.snapshots,
      approvals: snapshot.approvals,
      outbox: snapshot.outbox,
      deadLetters: snapshot.deadLetters,
    },
  };
}

function includeFromSearchParams(searchParams: URLSearchParams): WorkflowRunInclude | undefined {
  const raw = searchParams.get('include');
  if (!raw) return undefined;
  const values = new Set(raw.split(',').map((value) => value.trim()));
  return {
    ...(values.has('steps') ? { steps: true } : {}),
    ...(values.has('timeline') ? { timeline: true } : {}),
    ...(values.has('stateSnapshots') ? { stateSnapshots: true } : {}),
    ...(values.has('approvals') ? { approvals: true } : {}),
    ...(values.has('outbox') ? { outbox: true } : {}),
    ...(values.has('deadLetters') ? { deadLetters: true } : {}),
  };
}

async function readRequestJson(request: Request): Promise<unknown> {
  const text = await request.text();
  return parseJsonBody(text);
}

function parseJsonBody(text: string): unknown {
  if (text.trim().length === 0) return {};
  return JSON.parse(text);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function dateFromUnknown(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

function workflowReplayModeFromUnknown(value: unknown): WorkflowReplayMode | undefined {
  return value === 'recorded' || value === 'resume' || value === 'reexecute' || value === 'fork'
    ? value
    : undefined;
}
