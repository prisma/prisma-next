import { randomUUID } from 'node:crypto';
import { deepClone, workflowVersionId } from '../shared/path';
import type {
  WorkflowApprovalRecord,
  WorkflowArtifactRecord,
  WorkflowCanvasLayoutRecord,
  WorkflowConnectorAccountRecord,
  WorkflowConnectorCursorRecord,
  WorkflowDeadLetterRecord,
  WorkflowDefinitionIR,
  WorkflowDefinitionRecord,
  WorkflowIngestEventRecord,
  WorkflowLeaseRecord,
  WorkflowOutboxRecord,
  WorkflowRunRecord,
  WorkflowStateSnapshotRecord,
  WorkflowStepRunRecord,
  WorkflowStoreSnapshot,
  WorkflowTimelineEventRecord,
  WorkflowTimerRecord,
  WorkflowTriggerMatchRecord,
  WorkflowVersionRecord,
} from '../shared/types';

export interface WorkflowStore {
  upsertDefinitions(workflows: readonly WorkflowDefinitionIR[]): Promise<void>;
  snapshot(): Promise<WorkflowStoreSnapshot>;
  findWorkflowByName(name: string): Promise<WorkflowDefinitionIR | undefined>;
  findWorkflowVersion(versionId: string): Promise<WorkflowVersionRecord | undefined>;
  findWorkflowByTrigger(
    source: string,
    eventType: string,
  ): Promise<readonly WorkflowDefinitionIR[]>;
  createIngestEvent(
    event: Omit<WorkflowIngestEventRecord, 'id' | 'receivedAt'>,
  ): Promise<WorkflowIngestEventRecord>;
  ingestEventAndCreateRuns(
    input: WorkflowIngestAndCreateRunsInput,
  ): Promise<WorkflowIngestAndCreateRunsResult>;
  findIngestEventByDedupeKey(dedupeKey: string): Promise<WorkflowIngestEventRecord | undefined>;
  createRun(
    run: Omit<WorkflowRunRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowRunRecord>;
  createRunWithTimeline(input: CreateRunWithTimelineInput): Promise<WorkflowRunRecord>;
  createRunWithTimelineAndSnapshot(
    input: CreateRunWithTimelineAndSnapshotInput,
  ): Promise<WorkflowRunRecord>;
  updateRun(id: string, patch: Partial<WorkflowRunRecord>): Promise<WorkflowRunRecord>;
  updateRunIfLeased(input: LeasedRunUpdateInput): Promise<WorkflowRunRecord | undefined>;
  appendTimelineAndUpdateRunIfLeased(
    input: LeasedTimelineRunUpdateInput,
  ): Promise<WorkflowRunRecord | undefined>;
  supersedeReplayWaitsIfLeased(input: LeasedReplayWaitSupersedeInput): Promise<void>;
  findRun(id: string): Promise<WorkflowRunRecord | undefined>;
  nextQueuedRun(): Promise<WorkflowRunRecord | undefined>;
  claimNextRun(input: ClaimNextRunInput): Promise<WorkflowRunRecord | undefined>;
  claimRun(input: ClaimRunInput): Promise<WorkflowRunRecord | undefined>;
  claimNextRunWithLease(input: ClaimNextRunInput): Promise<WorkflowRunClaim | undefined>;
  claimRunWithLease(input: ClaimRunInput): Promise<WorkflowRunClaim | undefined>;
  claimApprovalRunWithLease(
    input: ClaimApprovalRunInput,
  ): Promise<WorkflowApprovalRunClaim | undefined>;
  findLease(
    resourceType: WorkflowLeaseRecord['resourceType'],
    resourceId: string,
    workerId?: string,
  ): Promise<WorkflowLeaseRecord | undefined>;
  inspectRun(input: InspectWorkflowRunInput): Promise<WorkflowRunInspection | undefined>;
  createStepRun(
    step: Omit<WorkflowStepRunRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowStepRunRecord>;
  findStepRun(id: string): Promise<WorkflowStepRunRecord | undefined>;
  createStepRunIfLeased(
    input: LeasedStepRunCreateInput,
  ): Promise<WorkflowStepRunRecord | undefined>;
  createStepRunAndAppendStartedTimelineIfLeased(
    input: LeasedStepRunStartInput,
  ): Promise<WorkflowStepRunRecord | undefined>;
  createCompletedStepAndAdvanceIfLeased(
    input: LeasedCompletedStepCreateInput,
  ): Promise<WorkflowRunRecord | undefined>;
  updateStepRun(id: string, patch: Partial<WorkflowStepRunRecord>): Promise<WorkflowStepRunRecord>;
  updateStepRunIfLeased(
    input: LeasedStepRunUpdateInput,
  ): Promise<WorkflowStepRunRecord | undefined>;
  completeStepAndAdvanceIfLeased(
    input: LeasedStepCompletionInput,
  ): Promise<WorkflowRunRecord | undefined>;
  failStepAndScheduleRetryIfLeased(
    input: LeasedStepRetryScheduleInput,
  ): Promise<WorkflowRunRecord | undefined>;
  appendTimeline(
    event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>,
  ): Promise<WorkflowTimelineEventRecord>;
  appendTimelineBatch(
    events: readonly Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>[],
  ): Promise<readonly WorkflowTimelineEventRecord[]>;
  appendTimelineIfLeased(
    input: LeasedTimelineAppendInput,
  ): Promise<WorkflowTimelineEventRecord | undefined>;
  appendSnapshot(
    snapshot: Omit<WorkflowStateSnapshotRecord, 'id' | 'sequence' | 'createdAt'>,
  ): Promise<WorkflowStateSnapshotRecord>;
  appendSnapshotIfLeased(
    input: LeasedSnapshotAppendInput,
  ): Promise<WorkflowStateSnapshotRecord | undefined>;
  createApproval(
    approval: Omit<WorkflowApprovalRecord, 'id' | 'requestedAt'>,
  ): Promise<WorkflowApprovalRecord>;
  createApprovalIfLeased(
    input: LeasedApprovalCreateInput,
  ): Promise<WorkflowApprovalRecord | undefined>;
  createApprovalAndWaitIfLeased(
    input: LeasedApprovalWaitInput,
  ): Promise<WorkflowRunRecord | undefined>;
  updateApproval(
    id: string,
    patch: Partial<WorkflowApprovalRecord>,
  ): Promise<WorkflowApprovalRecord>;
  resolveApprovalIfPending(
    input: ResolveApprovalIfPendingInput,
  ): Promise<WorkflowApprovalRecord | undefined>;
  resolveApprovalIfPendingIfLeased(
    input: LeasedApprovalResolveInput,
  ): Promise<WorkflowApprovalRecord | undefined>;
  resolveApprovalAndUpdateRunIfLeased(
    input: LeasedApprovalRunUpdateInput,
  ): Promise<WorkflowRunRecord | undefined>;
  findApproval(id: string): Promise<WorkflowApprovalRecord | undefined>;
  pendingApprovals(): Promise<readonly WorkflowApprovalRecord[]>;
  pendingApprovalForRun(runId: string): Promise<WorkflowApprovalRecord | undefined>;
  pendingApprovalForRunNode(
    runId: string,
    nodeId: string,
  ): Promise<WorkflowApprovalRecord | undefined>;
  readyApprovals(now?: Date): Promise<readonly WorkflowApprovalRecord[]>;
  createTriggerMatch(
    match: Omit<WorkflowTriggerMatchRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowTriggerMatchRecord>;
  acquireLease(input: {
    readonly resourceType: WorkflowLeaseRecord['resourceType'];
    readonly resourceId: string;
    readonly workerId: string;
    readonly ttlMs: number;
    readonly now?: Date;
  }): Promise<WorkflowLeaseRecord | undefined>;
  extendLease(input: ExtendWorkflowLeaseInput): Promise<WorkflowLeaseRecord | undefined>;
  releaseLease(
    resourceType: WorkflowLeaseRecord['resourceType'],
    resourceId: string,
    workerId?: string,
    leaseId?: string,
  ): Promise<void>;
  createTimer(timer: Omit<WorkflowTimerRecord, 'id' | 'createdAt'>): Promise<WorkflowTimerRecord>;
  createTimerIfLeased(input: LeasedTimerCreateInput): Promise<WorkflowTimerRecord | undefined>;
  updateTimer(id: string, patch: Partial<WorkflowTimerRecord>): Promise<WorkflowTimerRecord>;
  updateTimerIfLeased(input: LeasedTimerUpdateInput): Promise<WorkflowTimerRecord | undefined>;
  readyTimers(now?: Date): Promise<readonly WorkflowTimerRecord[]>;
  createOutbox(
    outbox: Omit<WorkflowOutboxRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowOutboxRecord>;
  createOutboxIfLeased(input: LeasedOutboxCreateInput): Promise<WorkflowOutboxRecord | undefined>;
  createExternalStepOutboxAndPauseIfLeased(
    input: LeasedExternalStepOutboxPauseInput,
  ): Promise<WorkflowExternalStepOutboxPauseResult | undefined>;
  claimNextOutbox(input: ClaimNextOutboxInput): Promise<WorkflowOutboxRecord | undefined>;
  claimNextOutboxWithLease(input: ClaimNextOutboxInput): Promise<WorkflowOutboxClaim | undefined>;
  claimNextOutboxAndRunWithLeases?(
    input: ClaimNextOutboxAndRunInput,
  ): Promise<WorkflowOutboxRunClaim | undefined>;
  updateOutbox(id: string, patch: Partial<WorkflowOutboxRecord>): Promise<WorkflowOutboxRecord>;
  updateOutboxIfLeased(input: LeasedOutboxUpdateInput): Promise<WorkflowOutboxRecord | undefined>;
  updateOutboxAndAppendTimelineIfLeased(
    input: LeasedOutboxTimelineUpdateInput,
  ): Promise<WorkflowOutboxRecord | undefined>;
  completeOutboxDispatchAndAdvanceIfLeased(
    input: LeasedOutboxDispatchCompletionInput,
  ): Promise<WorkflowRunRecord | undefined>;
  findOutboxWaiters(outboxId: string): Promise<readonly WorkflowStepRunRecord[]>;
  createDeadLetter(
    deadLetter: Omit<WorkflowDeadLetterRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowDeadLetterRecord>;
  createDeadLetterIfLeased(
    input: LeasedDeadLetterCreateInput,
  ): Promise<WorkflowDeadLetterRecord | undefined>;
  createArtifact(
    artifact: Omit<WorkflowArtifactRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowArtifactRecord>;
}

export interface WorkflowLeaseGuardInput {
  readonly leaseId: string;
  readonly resourceType: WorkflowLeaseRecord['resourceType'];
  readonly resourceId: string;
  readonly workerId: string;
  readonly now?: Date;
}

export interface LeasedRunUpdateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly runId: string;
  readonly patch: Partial<WorkflowRunRecord>;
}

export interface LeasedTimelineRunUpdateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly runId: string;
  readonly event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly patch: Partial<WorkflowRunRecord>;
  readonly releaseRunLease?: boolean;
}

export interface LeasedReplayWaitSupersedeInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly runId: string;
  readonly supersededAt?: Date;
}

export interface LeasedStepRunCreateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly step: Omit<WorkflowStepRunRecord, 'id' | 'createdAt'>;
}

export interface LeasedStepRunStartInput extends LeasedStepRunCreateInput {
  readonly event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
}

export interface CreateRunWithTimelineInput {
  readonly run: Omit<WorkflowRunRecord, 'id' | 'createdAt' | 'updatedAt'>;
  readonly event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
}

export interface CreateRunWithTimelineAndSnapshotInput extends CreateRunWithTimelineInput {
  readonly snapshot: Omit<WorkflowStateSnapshotRecord, 'id' | 'sequence' | 'createdAt'>;
}

export interface LeasedCompletedStepCreateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly step: Omit<WorkflowStepRunRecord, 'id' | 'createdAt'>;
  readonly startedEvent: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly completedEvent: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly terminalEvent?: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly snapshot: Omit<WorkflowStateSnapshotRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly runPatch: Pick<WorkflowRunRecord, 'state' | 'status'> &
    Partial<
      Pick<WorkflowRunRecord, 'currentNode' | 'error' | 'startedAt' | 'output' | 'completedAt'>
    >;
  readonly releaseRunLease?: boolean;
}

export interface LeasedStepRunUpdateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly stepRunId: string;
  readonly runId: string;
  readonly patch: Partial<WorkflowStepRunRecord>;
}

export interface LeasedTimelineAppendInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
}

export interface LeasedSnapshotAppendInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly snapshot: Omit<WorkflowStateSnapshotRecord, 'id' | 'sequence' | 'createdAt'>;
}

export interface LeasedStepCompletionInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly runId: string;
  readonly stepRunId: string;
  readonly stepOutput?: unknown;
  readonly completedAt: Date;
  readonly event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly snapshot: Omit<WorkflowStateSnapshotRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly runPatch: Pick<WorkflowRunRecord, 'state' | 'status'> &
    Partial<Pick<WorkflowRunRecord, 'currentNode' | 'error'>>;
}

export interface LeasedStepRetryScheduleInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly runId: string;
  readonly stepRunId: string;
  readonly message: string;
  readonly completedAt: Date;
  readonly event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly runPatch: Pick<WorkflowRunRecord, 'status'> &
    Partial<Pick<WorkflowRunRecord, 'currentNode' | 'error'>>;
}

export interface LeasedApprovalCreateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly approval: Omit<WorkflowApprovalRecord, 'id' | 'requestedAt'>;
}

export interface LeasedApprovalWaitInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly approval: Omit<WorkflowApprovalRecord, 'id' | 'requestedAt'>;
  readonly event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly runPatch: Partial<WorkflowRunRecord>;
}

export interface ResolveApprovalIfPendingInput {
  readonly approvalId: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly status: Exclude<WorkflowApprovalRecord['status'], 'pending'>;
  readonly resolvedBy: string;
  readonly resolvedAt?: Date;
  readonly decision?: unknown;
  readonly reason?: string;
}

export interface LeasedApprovalResolveInput extends ResolveApprovalIfPendingInput {
  readonly guard: WorkflowLeaseGuardInput;
}

export interface LeasedApprovalRunUpdateInput extends LeasedApprovalResolveInput {
  readonly event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly runPatch: Partial<WorkflowRunRecord>;
}

export interface LeasedTimerCreateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly timer: Omit<WorkflowTimerRecord, 'id' | 'createdAt'>;
}

export interface LeasedTimerUpdateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly timerId: string;
  readonly patch: Partial<WorkflowTimerRecord>;
}

export interface LeasedOutboxCreateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly outbox: Omit<WorkflowOutboxRecord, 'id' | 'createdAt'>;
}

export interface LeasedExternalStepOutboxPauseInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly step: Omit<WorkflowStepRunRecord, 'id' | 'createdAt' | 'output'>;
  readonly outbox: Omit<WorkflowOutboxRecord, 'id' | 'createdAt' | 'payload'> & {
    readonly payload: Record<string, unknown>;
  };
  readonly runPatch: Pick<WorkflowRunRecord, 'status' | 'currentNode'>;
  readonly claimOutboxLease?: {
    readonly workerId: string;
    readonly ttlMs: number;
    readonly now?: Date;
  };
}

export interface WorkflowExternalStepOutboxPauseResult {
  readonly run: WorkflowRunRecord;
  readonly outbox: WorkflowOutboxRecord;
  readonly stepRun: WorkflowStepRunRecord;
  readonly outboxLease?: WorkflowLeaseRecord;
}

export interface LeasedOutboxUpdateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly outboxId: string;
  readonly patch: Partial<WorkflowOutboxRecord>;
}

export interface LeasedOutboxTimelineUpdateInput extends LeasedOutboxUpdateInput {
  readonly event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
}

export interface LeasedOutboxDispatchCompletionInput {
  readonly runGuard: WorkflowLeaseGuardInput;
  readonly outboxGuard: WorkflowLeaseGuardInput;
  readonly runId: string;
  readonly outboxId: string;
  readonly stepRunId: string;
  readonly stepOutput?: unknown;
  readonly completedAt: Date;
  readonly outboxDispatchStartedEvent?: Omit<
    WorkflowTimelineEventRecord,
    'id' | 'sequence' | 'createdAt'
  >;
  readonly stepCompletedEvent: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly outboxDispatchedEvent: Omit<
    WorkflowTimelineEventRecord,
    'id' | 'sequence' | 'createdAt'
  >;
  readonly snapshot: Omit<WorkflowStateSnapshotRecord, 'id' | 'sequence' | 'createdAt'>;
  readonly runPatch: Pick<WorkflowRunRecord, 'state' | 'status'> &
    Partial<Pick<WorkflowRunRecord, 'currentNode' | 'error'>>;
  readonly outboxPatch: Pick<WorkflowOutboxRecord, 'payload' | 'status' | 'attempt'> &
    Partial<Pick<WorkflowOutboxRecord, 'dispatchedAt' | 'error'>>;
  readonly releaseOutboxLease?: boolean;
}

export interface LeasedDeadLetterCreateInput {
  readonly guard: WorkflowLeaseGuardInput;
  readonly deadLetter: Omit<WorkflowDeadLetterRecord, 'id' | 'createdAt'>;
}

export interface ClaimNextRunInput {
  readonly workerId: string;
  readonly ttlMs: number;
  readonly now?: Date;
}

export interface WorkflowRunClaim {
  readonly run: WorkflowRunRecord;
  readonly lease: WorkflowLeaseRecord;
}

export interface ClaimApprovalRunInput {
  readonly approvalId: string;
  readonly workerId: string;
  readonly ttlMs: number;
  readonly now?: Date;
}

export interface WorkflowApprovalRunClaim extends WorkflowRunClaim {
  readonly approval: WorkflowApprovalRecord;
}

export interface ClaimRunInput extends ClaimNextRunInput {
  readonly runId: string;
  readonly statuses?: readonly WorkflowRunRecord['status'][];
}

export interface ClaimNextOutboxInput {
  readonly workerId: string;
  readonly ttlMs: number;
  readonly now?: Date;
}

export interface ClaimNextOutboxAndRunInput extends ClaimNextOutboxInput {
  readonly runTtlMs: number;
}

export interface WorkflowOutboxClaim {
  readonly outbox: WorkflowOutboxRecord;
  readonly lease: WorkflowLeaseRecord;
}

export interface WorkflowOutboxRunClaim {
  readonly outbox: WorkflowOutboxRecord;
  readonly outboxLease: WorkflowLeaseRecord;
  readonly run: WorkflowRunRecord;
  readonly runLease: WorkflowLeaseRecord;
  readonly stepRun?: WorkflowStepRunRecord;
}

export interface ExtendWorkflowLeaseInput {
  readonly leaseId: string;
  readonly resourceType: WorkflowLeaseRecord['resourceType'];
  readonly resourceId: string;
  readonly workerId: string;
  readonly ttlMs: number;
  readonly now?: Date;
}

export interface WorkflowRunRelationsInclude {
  readonly steps?: boolean;
  readonly timeline?: boolean;
  readonly stateSnapshots?: boolean;
  readonly approvals?: boolean;
  readonly outbox?: boolean;
  readonly deadLetters?: boolean;
}

export interface InspectWorkflowRunInput {
  readonly runId: string;
  readonly include?: WorkflowRunRelationsInclude;
}

export interface WorkflowRunInspection {
  readonly run: WorkflowRunRecord;
  readonly steps?: readonly WorkflowStepRunRecord[];
  readonly timeline?: readonly WorkflowTimelineEventRecord[];
  readonly stateSnapshots?: readonly WorkflowStateSnapshotRecord[];
  readonly approvals?: readonly WorkflowApprovalRecord[];
  readonly outbox?: readonly WorkflowOutboxRecord[];
  readonly deadLetters?: readonly WorkflowDeadLetterRecord[];
}

const CLAIMABLE_RUN_STATUSES: readonly WorkflowRunRecord['status'][] = [
  'queued',
  'running',
  'paused',
  'waiting_for_approval',
  'waiting_for_timer',
];

export interface WorkflowIngestAndCreateRunsInput {
  readonly event: Omit<WorkflowIngestEventRecord, 'id' | 'receivedAt'>;
  readonly runs: readonly Omit<
    WorkflowRunRecord,
    'id' | 'createdAt' | 'updatedAt' | 'ingestEventId'
  >[];
}

export interface WorkflowIngestAndCreateRunsResult {
  readonly event: WorkflowIngestEventRecord;
  readonly runs: readonly WorkflowRunRecord[];
  readonly duplicate: boolean;
  readonly timelinesCreated?: boolean;
}

export class InMemoryWorkflowStore implements WorkflowStore {
  readonly #definitions = new Map<string, WorkflowDefinitionRecord>();
  readonly #versions = new Map<string, WorkflowVersionRecord>();
  readonly #compiled = new Map<string, WorkflowDefinitionIR>();
  readonly #ingestEvents = new Map<string, WorkflowIngestEventRecord>();
  readonly #triggerMatches = new Map<string, WorkflowTriggerMatchRecord>();
  readonly #runs = new Map<string, WorkflowRunRecord>();
  readonly #steps = new Map<string, WorkflowStepRunRecord>();
  readonly #timeline: WorkflowTimelineEventRecord[] = [];
  readonly #snapshots: WorkflowStateSnapshotRecord[] = [];
  readonly #approvals = new Map<string, WorkflowApprovalRecord>();
  readonly #leases = new Map<string, WorkflowLeaseRecord>();
  readonly #timers = new Map<string, WorkflowTimerRecord>();
  readonly #outbox = new Map<string, WorkflowOutboxRecord>();
  readonly #deadLetters = new Map<string, WorkflowDeadLetterRecord>();
  readonly #connectorAccounts = new Map<string, WorkflowConnectorAccountRecord>();
  readonly #connectorCursors = new Map<string, WorkflowConnectorCursorRecord>();
  readonly #canvasLayouts = new Map<string, WorkflowCanvasLayoutRecord>();
  readonly #artifacts = new Map<string, WorkflowArtifactRecord>();

  async upsertDefinitions(workflows: readonly WorkflowDefinitionIR[]): Promise<void> {
    const now = new Date();
    for (const workflow of workflows) {
      const existing = this.#definitions.get(workflow.id);
      this.#definitions.set(workflow.id, {
        id: workflow.id,
        name: workflow.name,
        slug: workflow.slug,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      const versionId = workflowVersionId(workflow);
      if (!this.#versions.has(versionId)) {
        this.#versions.set(versionId, {
          id: versionId,
          workflowId: workflow.id,
          version: workflow.version,
          status: 'active',
          sourceHash: workflow.sourceHash,
          compiledGraph: workflow,
          visualGraph: workflow.canvas,
          createdAt: now,
        });
      }
      this.#compiled.set(workflow.name, workflow);
    }
  }

  async snapshot(): Promise<WorkflowStoreSnapshot> {
    return deepClone({
      definitions: [...this.#definitions.values()],
      versions: [...this.#versions.values()],
      ingestEvents: [...this.#ingestEvents.values()],
      triggerMatches: [...this.#triggerMatches.values()],
      runs: [...this.#runs.values()],
      steps: [...this.#steps.values()],
      timeline: this.#timeline,
      snapshots: this.#snapshots,
      approvals: [...this.#approvals.values()],
      leases: [...this.#leases.values()],
      timers: [...this.#timers.values()],
      outbox: [...this.#outbox.values()],
      deadLetters: [...this.#deadLetters.values()],
      connectorAccounts: [...this.#connectorAccounts.values()],
      connectorCursors: [...this.#connectorCursors.values()],
      canvasLayouts: [...this.#canvasLayouts.values()],
      artifacts: [...this.#artifacts.values()],
    });
  }

  async findWorkflowByName(name: string): Promise<WorkflowDefinitionIR | undefined> {
    return this.#compiled.get(name);
  }

  async findWorkflowVersion(versionId: string): Promise<WorkflowVersionRecord | undefined> {
    return this.#versions.get(versionId);
  }

  async findWorkflowByTrigger(
    source: string,
    eventType: string,
  ): Promise<readonly WorkflowDefinitionIR[]> {
    return [...this.#compiled.values()].filter((workflow) =>
      workflow.triggers.some((trigger) => trigger.source === source && trigger.event === eventType),
    );
  }

  async createIngestEvent(
    event: Omit<WorkflowIngestEventRecord, 'id' | 'receivedAt'>,
  ): Promise<WorkflowIngestEventRecord> {
    const record = { ...event, id: id('evt'), receivedAt: new Date() };
    this.#ingestEvents.set(record.id, record);
    return record;
  }

  async ingestEventAndCreateRuns(
    input: WorkflowIngestAndCreateRunsInput,
  ): Promise<WorkflowIngestAndCreateRunsResult> {
    const existing = [...this.#ingestEvents.values()].find(
      (event) => event.dedupeKey === input.event.dedupeKey,
    );
    if (existing) {
      return { event: existing, runs: [], duplicate: true };
    }
    const event = { ...input.event, id: id('evt'), receivedAt: new Date() };
    this.#ingestEvents.set(event.id, event);
    if (input.runs.length === 1) {
      const runInput = input.runs[0];
      if (!runInput) {
        throw new Error('Expected one workflow run for single-run ingest fast path.');
      }
      const match = await this.createTriggerMatch({
        ingestEventId: event.id,
        workflowId: runInput.workflowId,
        versionId: runInput.versionId,
      });
      if (!match) return { event, runs: [], duplicate: false };
      const run = await this.createRun({
        ...runInput,
        ingestEventId: event.id,
      });
      await this.appendTimeline({
        runId: run.id,
        type: 'INGEST_MATCHED',
        payload: {
          eventId: event.id,
          source: input.event.source,
          eventType: input.event.eventType,
        },
      });
      return { event, runs: [run], duplicate: false, timelinesCreated: true };
    }
    const runs: WorkflowRunRecord[] = [];
    for (const runInput of input.runs) {
      const match = await this.createTriggerMatch({
        ingestEventId: event.id,
        workflowId: runInput.workflowId,
        versionId: runInput.versionId,
      });
      if (!match) continue;
      runs.push(
        await this.createRun({
          ...runInput,
          ingestEventId: event.id,
        }),
      );
    }
    return { event, runs, duplicate: false };
  }

  async findIngestEventByDedupeKey(
    dedupeKey: string,
  ): Promise<WorkflowIngestEventRecord | undefined> {
    return [...this.#ingestEvents.values()].find((event) => event.dedupeKey === dedupeKey);
  }

  async createRun(
    run: Omit<WorkflowRunRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowRunRecord> {
    const now = new Date();
    const record = { ...run, id: id('run'), createdAt: now, updatedAt: now };
    this.#runs.set(record.id, record);
    return record;
  }

  async createRunWithTimeline(input: CreateRunWithTimelineInput): Promise<WorkflowRunRecord> {
    const run = await this.createRun(input.run);
    await this.appendTimeline({ ...input.event, runId: run.id });
    return run;
  }

  async createRunWithTimelineAndSnapshot(
    input: CreateRunWithTimelineAndSnapshotInput,
  ): Promise<WorkflowRunRecord> {
    const run = await this.createRunWithTimeline(input);
    await this.appendSnapshot({ ...input.snapshot, runId: run.id });
    return run;
  }

  async updateRun(idValue: string, patch: Partial<WorkflowRunRecord>): Promise<WorkflowRunRecord> {
    const existing = this.#runs.get(idValue);
    if (!existing) throw new Error(`Workflow run not found: ${idValue}`);
    const next = { ...existing, ...patch, updatedAt: new Date() };
    this.#runs.set(idValue, next);
    return next;
  }

  async updateRunIfLeased(input: LeasedRunUpdateInput): Promise<WorkflowRunRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.runId)) return undefined;
    return this.updateRun(input.runId, input.patch);
  }

  async appendTimelineAndUpdateRunIfLeased(
    input: LeasedTimelineRunUpdateInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.runId)) return undefined;
    await this.appendTimeline(input.event);
    const run = await this.updateRun(input.runId, input.patch);
    if (input.releaseRunLease) {
      await this.releaseLease(
        input.guard.resourceType,
        input.guard.resourceId,
        input.guard.workerId,
        input.guard.leaseId,
      );
    }
    return run;
  }

  async supersedeReplayWaitsIfLeased(input: LeasedReplayWaitSupersedeInput): Promise<void> {
    if (!this.#hasActiveRunLease(input.guard, input.runId)) return;
    const supersededAt = input.supersededAt ?? new Date();
    for (const approval of this.#approvals.values()) {
      if (approval.runId === input.runId && approval.status === 'pending') {
        this.#approvals.set(approval.id, {
          ...approval,
          status: 'expired',
          resolvedAt: supersededAt,
          resolvedBy: 'system:workflow-replay',
          reason: 'Superseded by replay',
        });
      }
    }
    for (const timer of this.#timers.values()) {
      if (
        timer.runId === input.runId &&
        (timer.status === 'scheduled' || timer.status === 'completed')
      ) {
        this.#timers.set(timer.id, { ...timer, status: 'cancelled' });
      }
    }
  }

  async findRun(idValue: string): Promise<WorkflowRunRecord | undefined> {
    return this.#runs.get(idValue);
  }

  async nextQueuedRun(): Promise<WorkflowRunRecord | undefined> {
    return [...this.#runs.values()].find((run) => run.status === 'queued');
  }

  async claimNextRun(input: ClaimNextRunInput): Promise<WorkflowRunRecord | undefined> {
    return (await this.claimNextRunWithLease(input))?.run;
  }

  async claimNextRunWithLease(input: ClaimNextRunInput): Promise<WorkflowRunClaim | undefined> {
    const now = input.now ?? new Date();
    const runnable = [...this.#runs.values()]
      .filter((run) => run.status === 'queued' || run.status === 'running')
      .filter((run) => {
        const lease = this.#leases.get(leaseKey('run', run.id));
        return lease === undefined || lease.lockedUntil <= now;
      })
      .sort((left, right) => {
        const leftRank = left.status === 'queued' ? 0 : 1;
        const rightRank = right.status === 'queued' ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.createdAt.valueOf() - right.createdAt.valueOf();
      })[0];
    if (!runnable) return undefined;
    const lease = await this.acquireLease({
      resourceType: 'run',
      resourceId: runnable.id,
      workerId: input.workerId,
      ttlMs: input.ttlMs,
      now,
    });
    return lease ? { run: runnable, lease } : undefined;
  }

  async claimRun(input: ClaimRunInput): Promise<WorkflowRunRecord | undefined> {
    return (await this.claimRunWithLease(input))?.run;
  }

  async claimRunWithLease(input: ClaimRunInput): Promise<WorkflowRunClaim | undefined> {
    const run = this.#runs.get(input.runId);
    const statuses = input.statuses ?? CLAIMABLE_RUN_STATUSES;
    if (!run || !statuses.includes(run.status)) {
      return undefined;
    }
    const lease = await this.acquireLease({
      resourceType: 'run',
      resourceId: input.runId,
      workerId: input.workerId,
      ttlMs: input.ttlMs,
      ...(input.now !== undefined ? { now: input.now } : {}),
    });
    return lease ? { run, lease } : undefined;
  }

  async claimApprovalRunWithLease(
    input: ClaimApprovalRunInput,
  ): Promise<WorkflowApprovalRunClaim | undefined> {
    const approval = this.#approvals.get(input.approvalId);
    if (!approval || approval.status !== 'pending') return undefined;
    const run = this.#runs.get(approval.runId);
    if (!run || run.status !== 'waiting_for_approval' || run.currentNode !== approval.nodeId) {
      return undefined;
    }
    const claimed = await this.claimRunWithLease({
      runId: approval.runId,
      workerId: input.workerId,
      ttlMs: input.ttlMs,
      statuses: ['waiting_for_approval'],
      ...(input.now !== undefined ? { now: input.now } : {}),
    });
    return claimed ? { approval, run: claimed.run, lease: claimed.lease } : undefined;
  }

  async findLease(
    resourceType: WorkflowLeaseRecord['resourceType'],
    resourceId: string,
    workerId?: string,
  ): Promise<WorkflowLeaseRecord | undefined> {
    const lease = this.#leases.get(leaseKey(resourceType, resourceId));
    if (!lease || (workerId !== undefined && lease.workerId !== workerId)) return undefined;
    return lease;
  }

  async inspectRun(input: InspectWorkflowRunInput): Promise<WorkflowRunInspection | undefined> {
    const run = this.#runs.get(input.runId);
    if (!run) return undefined;
    const include = input.include ?? {};
    return {
      run,
      ...(include.steps === true
        ? { steps: [...this.#steps.values()].filter((step) => step.runId === input.runId) }
        : {}),
      ...(include.timeline === true
        ? { timeline: this.#timeline.filter((event) => event.runId === input.runId) }
        : {}),
      ...(include.stateSnapshots === true
        ? { stateSnapshots: this.#snapshots.filter((entry) => entry.runId === input.runId) }
        : {}),
      ...(include.approvals === true
        ? {
            approvals: [...this.#approvals.values()].filter(
              (approval) => approval.runId === input.runId,
            ),
          }
        : {}),
      ...(include.outbox === true
        ? { outbox: [...this.#outbox.values()].filter((entry) => entry.runId === input.runId) }
        : {}),
      ...(include.deadLetters === true
        ? {
            deadLetters: [...this.#deadLetters.values()].filter(
              (entry) => entry.resourceId === input.runId,
            ),
          }
        : {}),
    };
  }

  async createStepRun(
    step: Omit<WorkflowStepRunRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowStepRunRecord> {
    const record = { ...step, id: id('step'), createdAt: new Date() };
    this.#steps.set(record.id, record);
    return record;
  }

  async findStepRun(idValue: string): Promise<WorkflowStepRunRecord | undefined> {
    return this.#steps.get(idValue);
  }

  async createStepRunIfLeased(
    input: LeasedStepRunCreateInput,
  ): Promise<WorkflowStepRunRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.step.runId)) return undefined;
    return this.createStepRun(input.step);
  }

  async createStepRunAndAppendStartedTimelineIfLeased(
    input: LeasedStepRunStartInput,
  ): Promise<WorkflowStepRunRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.step.runId)) return undefined;
    const step = await this.createStepRun(input.step);
    await this.appendTimeline(input.event);
    return step;
  }

  async createCompletedStepAndAdvanceIfLeased(
    input: LeasedCompletedStepCreateInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.step.runId)) return undefined;
    await this.createStepRun(input.step);
    await this.appendTimeline(input.startedEvent);
    await this.appendTimeline(input.completedEvent);
    if (input.terminalEvent) {
      await this.appendTimeline(input.terminalEvent);
    }
    await this.appendSnapshot(input.snapshot);
    const run = await this.updateRun(input.step.runId, input.runPatch);
    if (input.releaseRunLease) {
      await this.releaseLease(
        input.guard.resourceType,
        input.guard.resourceId,
        input.guard.workerId,
        input.guard.leaseId,
      );
    }
    return run;
  }

  async updateStepRun(
    idValue: string,
    patch: Partial<WorkflowStepRunRecord>,
  ): Promise<WorkflowStepRunRecord> {
    const existing = this.#steps.get(idValue);
    if (!existing) throw new Error(`Workflow step run not found: ${idValue}`);
    const next = { ...existing, ...patch };
    this.#steps.set(idValue, next);
    return next;
  }

  async updateStepRunIfLeased(
    input: LeasedStepRunUpdateInput,
  ): Promise<WorkflowStepRunRecord | undefined> {
    const existing = this.#steps.get(input.stepRunId);
    if (
      !existing ||
      existing.runId !== input.runId ||
      !this.#hasActiveRunLease(input.guard, input.runId)
    ) {
      return undefined;
    }
    return this.updateStepRun(input.stepRunId, input.patch);
  }

  async completeStepAndAdvanceIfLeased(
    input: LeasedStepCompletionInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.runId)) return undefined;
    await this.updateStepRun(input.stepRunId, {
      status: 'completed',
      output: input.stepOutput,
      completedAt: input.completedAt,
    });
    await this.appendTimeline(input.event);
    await this.appendSnapshot(input.snapshot);
    return this.updateRun(input.runId, input.runPatch);
  }

  async failStepAndScheduleRetryIfLeased(
    input: LeasedStepRetryScheduleInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.runId)) return undefined;
    await this.updateStepRun(input.stepRunId, {
      status: 'failed',
      error: { message: input.message },
      completedAt: input.completedAt,
    });
    await this.appendTimeline(input.event);
    return this.updateRun(input.runId, input.runPatch);
  }

  async appendTimeline(
    event: Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>,
  ): Promise<WorkflowTimelineEventRecord> {
    const sequence = this.#timeline.filter((entry) => entry.runId === event.runId).length + 1;
    const record = { ...event, id: id('tl'), sequence, createdAt: new Date() };
    this.#timeline.push(record);
    return record;
  }

  async appendTimelineBatch(
    events: readonly Omit<WorkflowTimelineEventRecord, 'id' | 'sequence' | 'createdAt'>[],
  ): Promise<readonly WorkflowTimelineEventRecord[]> {
    const appended: WorkflowTimelineEventRecord[] = [];
    for (const event of events) {
      appended.push(await this.appendTimeline(event));
    }
    return appended;
  }

  async appendTimelineIfLeased(
    input: LeasedTimelineAppendInput,
  ): Promise<WorkflowTimelineEventRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.event.runId)) return undefined;
    return this.appendTimeline(input.event);
  }

  async appendSnapshot(
    snapshot: Omit<WorkflowStateSnapshotRecord, 'id' | 'sequence' | 'createdAt'>,
  ): Promise<WorkflowStateSnapshotRecord> {
    const sequence = this.#snapshots.filter((entry) => entry.runId === snapshot.runId).length + 1;
    const previous = [...this.#snapshots].reverse().find((entry) => entry.runId === snapshot.runId);
    const record = {
      ...snapshot,
      diff: snapshot.diff ?? shallowDiff(previous?.state, snapshot.state),
      id: id('snap'),
      sequence,
      createdAt: new Date(),
    };
    this.#snapshots.push(record);
    return record;
  }

  async appendSnapshotIfLeased(
    input: LeasedSnapshotAppendInput,
  ): Promise<WorkflowStateSnapshotRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.snapshot.runId)) return undefined;
    return this.appendSnapshot(input.snapshot);
  }

  async createApproval(
    approval: Omit<WorkflowApprovalRecord, 'id' | 'requestedAt'>,
  ): Promise<WorkflowApprovalRecord> {
    const record = { ...approval, id: id('approval'), requestedAt: new Date() };
    this.#approvals.set(record.id, record);
    return record;
  }

  async createApprovalIfLeased(
    input: LeasedApprovalCreateInput,
  ): Promise<WorkflowApprovalRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.approval.runId)) return undefined;
    return this.createApproval(input.approval);
  }

  async createApprovalAndWaitIfLeased(
    input: LeasedApprovalWaitInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.approval.runId)) return undefined;
    await this.createApproval(input.approval);
    await this.appendTimeline(input.event);
    return this.updateRun(input.approval.runId, input.runPatch);
  }

  async updateApproval(
    idValue: string,
    patch: Partial<WorkflowApprovalRecord>,
  ): Promise<WorkflowApprovalRecord> {
    const existing = this.#approvals.get(idValue);
    if (!existing) throw new Error(`Workflow approval not found: ${idValue}`);
    const next = { ...existing, ...patch };
    this.#approvals.set(idValue, next);
    return next;
  }

  async resolveApprovalIfPending(
    input: ResolveApprovalIfPendingInput,
  ): Promise<WorkflowApprovalRecord | undefined> {
    const existing = this.#approvals.get(input.approvalId);
    if (
      !existing ||
      existing.status !== 'pending' ||
      existing.runId !== input.runId ||
      existing.nodeId !== input.nodeId
    ) {
      return undefined;
    }
    return this.updateApproval(input.approvalId, {
      status: input.status,
      resolvedAt: input.resolvedAt ?? new Date(),
      resolvedBy: input.resolvedBy,
      ...(input.decision !== undefined ? { decision: input.decision } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    });
  }

  async resolveApprovalIfPendingIfLeased(
    input: LeasedApprovalResolveInput,
  ): Promise<WorkflowApprovalRecord | undefined> {
    const run = this.#runs.get(input.runId);
    if (
      !run ||
      run.status !== 'waiting_for_approval' ||
      run.currentNode !== input.nodeId ||
      input.guard.resourceType !== 'run' ||
      input.guard.resourceId !== input.runId ||
      !this.#hasActiveLease(input.guard)
    ) {
      return undefined;
    }
    return this.resolveApprovalIfPending(input);
  }

  async resolveApprovalAndUpdateRunIfLeased(
    input: LeasedApprovalRunUpdateInput,
  ): Promise<WorkflowRunRecord | undefined> {
    const run = this.#runs.get(input.runId);
    if (
      !run ||
      run.status !== 'waiting_for_approval' ||
      run.currentNode !== input.nodeId ||
      input.guard.resourceType !== 'run' ||
      input.guard.resourceId !== input.runId ||
      !this.#hasActiveLease(input.guard)
    ) {
      return undefined;
    }
    const resolved = await this.resolveApprovalIfPending(input);
    if (!resolved) return undefined;
    await this.appendTimeline(input.event);
    return this.updateRun(input.runId, input.runPatch);
  }

  async findApproval(idValue: string): Promise<WorkflowApprovalRecord | undefined> {
    return this.#approvals.get(idValue);
  }

  async pendingApprovals(): Promise<readonly WorkflowApprovalRecord[]> {
    return [...this.#approvals.values()]
      .filter((approval) => approval.status === 'pending')
      .sort((left, right) => left.requestedAt.valueOf() - right.requestedAt.valueOf());
  }

  async pendingApprovalForRun(runId: string): Promise<WorkflowApprovalRecord | undefined> {
    return [...this.#approvals.values()].find(
      (approval) => approval.runId === runId && approval.status === 'pending',
    );
  }

  async pendingApprovalForRunNode(
    runId: string,
    nodeId: string,
  ): Promise<WorkflowApprovalRecord | undefined> {
    return [...this.#approvals.values()].find(
      (approval) =>
        approval.runId === runId && approval.nodeId === nodeId && approval.status === 'pending',
    );
  }

  async readyApprovals(now = new Date()): Promise<readonly WorkflowApprovalRecord[]> {
    return [...this.#approvals.values()]
      .filter(
        (approval) =>
          approval.status === 'pending' &&
          approval.expiresAt !== undefined &&
          approval.expiresAt <= now,
      )
      .sort((left, right) => approvalExpiry(left) - approvalExpiry(right));
  }

  async createTriggerMatch(
    match: Omit<WorkflowTriggerMatchRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowTriggerMatchRecord> {
    const existing = [...this.#triggerMatches.values()].find(
      (candidate) =>
        candidate.ingestEventId === match.ingestEventId &&
        candidate.workflowId === match.workflowId &&
        candidate.versionId === match.versionId,
    );
    if (existing) {
      return existing;
    }
    const record = { ...match, id: id('match'), createdAt: new Date() };
    this.#triggerMatches.set(record.id, record);
    return record;
  }

  async acquireLease(input: {
    readonly resourceType: WorkflowLeaseRecord['resourceType'];
    readonly resourceId: string;
    readonly workerId: string;
    readonly ttlMs: number;
    readonly now?: Date;
  }): Promise<WorkflowLeaseRecord | undefined> {
    const now = input.now ?? new Date();
    const key = leaseKey(input.resourceType, input.resourceId);
    const existing = this.#leases.get(key);
    if (existing && existing.lockedUntil > now) {
      return undefined;
    }
    const record = {
      id: id('lease'),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      workerId: input.workerId,
      lockedUntil: new Date(now.getTime() + input.ttlMs),
      heartbeatAt: now,
    };
    this.#leases.set(key, record);
    return record;
  }

  async extendLease(input: ExtendWorkflowLeaseInput): Promise<WorkflowLeaseRecord | undefined> {
    const now = input.now ?? new Date();
    const key = leaseKey(input.resourceType, input.resourceId);
    const existing = this.#leases.get(key);
    if (
      !existing ||
      existing.id !== input.leaseId ||
      existing.workerId !== input.workerId ||
      existing.lockedUntil <= now
    ) {
      return undefined;
    }
    const record = {
      ...existing,
      lockedUntil: new Date(now.getTime() + input.ttlMs),
      heartbeatAt: now,
    };
    this.#leases.set(key, record);
    return record;
  }

  async releaseLease(
    resourceType: WorkflowLeaseRecord['resourceType'],
    resourceId: string,
    workerId?: string,
    leaseId?: string,
  ): Promise<void> {
    const key = leaseKey(resourceType, resourceId);
    const existing = this.#leases.get(key);
    if (workerId !== undefined && existing?.workerId !== workerId) {
      return;
    }
    if (leaseId !== undefined && existing?.id !== leaseId) {
      return;
    }
    this.#leases.delete(key);
  }

  async createTimer(
    timer: Omit<WorkflowTimerRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowTimerRecord> {
    const record = { ...timer, id: id('timer'), createdAt: new Date() };
    this.#timers.set(record.id, record);
    return record;
  }

  async createTimerIfLeased(
    input: LeasedTimerCreateInput,
  ): Promise<WorkflowTimerRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.timer.runId)) return undefined;
    return this.createTimer(input.timer);
  }

  async updateTimer(
    idValue: string,
    patch: Partial<WorkflowTimerRecord>,
  ): Promise<WorkflowTimerRecord> {
    const existing = this.#timers.get(idValue);
    if (!existing) throw new Error(`Workflow timer not found: ${idValue}`);
    const next = { ...existing, ...patch };
    this.#timers.set(idValue, next);
    return next;
  }

  async updateTimerIfLeased(
    input: LeasedTimerUpdateInput,
  ): Promise<WorkflowTimerRecord | undefined> {
    if (
      !this.#timers.has(input.timerId) ||
      !this.#hasActiveResourceLease(input.guard, 'timer', input.timerId)
    ) {
      return undefined;
    }
    return this.updateTimer(input.timerId, input.patch);
  }

  async readyTimers(now = new Date()): Promise<readonly WorkflowTimerRecord[]> {
    return [...this.#timers.values()].filter(
      (timer) => timer.status === 'scheduled' && timer.resumeAt <= now,
    );
  }

  async createOutbox(
    outbox: Omit<WorkflowOutboxRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowOutboxRecord> {
    if (outbox.idempotencyKey !== undefined) {
      const existing = [...this.#outbox.values()].find(
        (candidate) =>
          candidate.destination === outbox.destination &&
          candidate.idempotencyKey === outbox.idempotencyKey,
      );
      if (existing) {
        return existing;
      }
    }
    const record = {
      ...outbox,
      attempt: outbox.attempt ?? 1,
      id: id('outbox'),
      createdAt: new Date(),
    };
    this.#outbox.set(record.id, record);
    return record;
  }

  async createOutboxIfLeased(
    input: LeasedOutboxCreateInput,
  ): Promise<WorkflowOutboxRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.outbox.runId)) return undefined;
    return this.createOutbox(input.outbox);
  }

  async createExternalStepOutboxAndPauseIfLeased(
    input: LeasedExternalStepOutboxPauseInput,
  ): Promise<WorkflowExternalStepOutboxPauseResult | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.step.runId)) return undefined;
    const existing =
      input.outbox.idempotencyKey === undefined
        ? undefined
        : [...this.#outbox.values()].find(
            (candidate) =>
              candidate.destination === input.outbox.destination &&
              candidate.idempotencyKey === input.outbox.idempotencyKey,
          );
    if (existing && existing.status !== 'pending') return undefined;
    const step = await this.createStepRun(input.step);
    const outbox =
      existing ??
      (await this.createOutbox({
        ...input.outbox,
        payload: { ...input.outbox.payload, stepRunId: step.id },
      }));
    const outboxPayload = recordFromUnknown(outbox.payload);
    const ownsOutbox = outboxPayload['stepRunId'] === step.id;
    if (!ownsOutbox) {
      await this.updateStepRun(step.id, {
        status: 'queued',
        output: { outboxId: outbox.id },
      });
    }
    await this.appendTimeline({
      runId: input.step.runId,
      nodeId: input.step.nodeId,
      type: ownsOutbox ? 'OUTBOX_PENDING' : 'OUTBOX_WAITING',
      payload: { outboxId: outbox.id, destination: outbox.destination },
    });
    const run = await this.updateRun(input.step.runId, input.runPatch);
    const latestStep = this.#steps.get(step.id) ?? step;
    const outboxLease = input.claimOutboxLease
      ? await this.acquireLease({
          resourceType: 'outbox',
          resourceId: outbox.id,
          workerId: input.claimOutboxLease.workerId,
          ttlMs: input.claimOutboxLease.ttlMs,
          ...(input.claimOutboxLease.now !== undefined ? { now: input.claimOutboxLease.now } : {}),
        })
      : undefined;
    return {
      run,
      outbox,
      stepRun: latestStep,
      ...(outboxLease !== undefined ? { outboxLease } : {}),
    };
  }

  async claimNextOutbox(input: ClaimNextOutboxInput): Promise<WorkflowOutboxRecord | undefined> {
    return (await this.claimNextOutboxWithLease(input))?.outbox;
  }

  async claimNextOutboxWithLease(
    input: ClaimNextOutboxInput,
  ): Promise<WorkflowOutboxClaim | undefined> {
    const now = input.now ?? new Date();
    const candidates = [...this.#outbox.values()]
      .filter(
        (entry) =>
          entry.status === 'pending' &&
          (entry.availableAt === undefined || entry.availableAt <= now),
      )
      .sort(
        (left, right) =>
          (left.availableAt ?? left.createdAt).valueOf() -
            (right.availableAt ?? right.createdAt).valueOf() ||
          left.createdAt.valueOf() - right.createdAt.valueOf(),
      );
    for (const candidate of candidates) {
      const lease = await this.acquireLease({
        resourceType: 'outbox',
        resourceId: candidate.id,
        workerId: input.workerId,
        ttlMs: input.ttlMs,
        ...(input.now !== undefined ? { now: input.now } : {}),
      });
      if (lease) return { outbox: candidate, lease };
    }
    return undefined;
  }

  async claimNextOutboxAndRunWithLeases(
    input: ClaimNextOutboxAndRunInput,
  ): Promise<WorkflowOutboxRunClaim | undefined> {
    const outboxClaim = await this.claimNextOutboxWithLease(input);
    if (!outboxClaim) return undefined;
    const runClaim = await this.claimRunWithLease({
      runId: outboxClaim.outbox.runId,
      workerId: input.workerId,
      ttlMs: input.runTtlMs,
      ...(input.now !== undefined ? { now: input.now } : {}),
    });
    if (!runClaim) {
      await this.releaseLease(
        outboxClaim.lease.resourceType,
        outboxClaim.lease.resourceId,
        outboxClaim.lease.workerId,
        outboxClaim.lease.id,
      );
      return undefined;
    }
    return {
      outbox: outboxClaim.outbox,
      outboxLease: outboxClaim.lease,
      run: runClaim.run,
      runLease: runClaim.lease,
    };
  }

  async updateOutbox(
    idValue: string,
    patch: Partial<WorkflowOutboxRecord>,
  ): Promise<WorkflowOutboxRecord> {
    const existing = this.#outbox.get(idValue);
    if (!existing) throw new Error(`Workflow outbox entry not found: ${idValue}`);
    const next = { ...existing, ...patch };
    this.#outbox.set(idValue, next);
    return next;
  }

  async updateOutboxIfLeased(
    input: LeasedOutboxUpdateInput,
  ): Promise<WorkflowOutboxRecord | undefined> {
    if (
      !this.#outbox.has(input.outboxId) ||
      !this.#hasActiveResourceLease(input.guard, 'outbox', input.outboxId)
    ) {
      return undefined;
    }
    return this.updateOutbox(input.outboxId, input.patch);
  }

  async updateOutboxAndAppendTimelineIfLeased(
    input: LeasedOutboxTimelineUpdateInput,
  ): Promise<WorkflowOutboxRecord | undefined> {
    if (
      !this.#outbox.has(input.outboxId) ||
      !this.#hasActiveResourceLease(input.guard, 'outbox', input.outboxId)
    ) {
      return undefined;
    }
    const outbox = await this.updateOutbox(input.outboxId, input.patch);
    await this.appendTimeline(input.event);
    return outbox;
  }

  async completeOutboxDispatchAndAdvanceIfLeased(
    input: LeasedOutboxDispatchCompletionInput,
  ): Promise<WorkflowRunRecord | undefined> {
    if (
      !this.#hasActiveRunLease(input.runGuard, input.runId) ||
      !this.#outbox.has(input.outboxId) ||
      !this.#hasActiveResourceLease(input.outboxGuard, 'outbox', input.outboxId)
    ) {
      return undefined;
    }
    await this.updateStepRun(input.stepRunId, {
      status: 'completed',
      output: input.stepOutput,
      completedAt: input.completedAt,
    });
    await this.updateOutbox(input.outboxId, input.outboxPatch);
    if (input.outboxDispatchStartedEvent) {
      await this.appendTimeline(input.outboxDispatchStartedEvent);
    }
    await this.appendTimeline(input.stepCompletedEvent);
    await this.appendTimeline(input.outboxDispatchedEvent);
    await this.appendSnapshot(input.snapshot);
    const run = await this.updateRun(input.runId, input.runPatch);
    if (input.releaseOutboxLease) {
      await this.releaseLease(
        input.outboxGuard.resourceType,
        input.outboxGuard.resourceId,
        input.outboxGuard.workerId,
        input.outboxGuard.leaseId,
      );
    }
    return run;
  }

  async findOutboxWaiters(outboxId: string): Promise<readonly WorkflowStepRunRecord[]> {
    return [...this.#steps.values()].filter(
      (step) => step.status === 'queued' && outboxReferenceId(step.output) === outboxId,
    );
  }

  async createDeadLetter(
    deadLetter: Omit<WorkflowDeadLetterRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowDeadLetterRecord> {
    const record = { ...deadLetter, id: id('dlq'), createdAt: new Date() };
    this.#deadLetters.set(record.id, record);
    return record;
  }

  async createDeadLetterIfLeased(
    input: LeasedDeadLetterCreateInput,
  ): Promise<WorkflowDeadLetterRecord | undefined> {
    if (!this.#hasActiveRunLease(input.guard, input.deadLetter.resourceId)) return undefined;
    return this.createDeadLetter(input.deadLetter);
  }

  async createArtifact(
    artifact: Omit<WorkflowArtifactRecord, 'id' | 'createdAt'>,
  ): Promise<WorkflowArtifactRecord> {
    const record = { ...artifact, id: id('artifact'), createdAt: new Date() };
    this.#artifacts.set(record.id, record);
    return record;
  }

  #hasActiveLease(input: WorkflowLeaseGuardInput): boolean {
    const now = input.now ?? new Date();
    const lease = this.#leases.get(leaseKey(input.resourceType, input.resourceId));
    return (
      lease?.id === input.leaseId && lease.workerId === input.workerId && lease.lockedUntil > now
    );
  }

  #hasActiveRunLease(input: WorkflowLeaseGuardInput, runId: string): boolean {
    return (
      input.resourceType === 'run' && input.resourceId === runId && this.#hasActiveLease(input)
    );
  }

  #hasActiveResourceLease(
    input: WorkflowLeaseGuardInput,
    resourceType: WorkflowLeaseRecord['resourceType'],
    resourceId: string,
  ): boolean {
    return (
      input.resourceType === resourceType &&
      input.resourceId === resourceId &&
      this.#hasActiveLease(input)
    );
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function leaseKey(resourceType: WorkflowLeaseRecord['resourceType'], resourceId: string): string {
  return `${resourceType}:${resourceId}`;
}

function outboxReferenceId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = Object.entries(value).find(([key]) => key === 'outboxId')?.[1];
  return typeof candidate === 'string' ? candidate : undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function approvalExpiry(approval: WorkflowApprovalRecord): number {
  return approval.expiresAt?.valueOf() ?? Number.POSITIVE_INFINITY;
}

function shallowDiff(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, { readonly before?: unknown; readonly after?: unknown }> {
  const out: Record<string, { readonly before?: unknown; readonly after?: unknown }> = {};
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next)]);
  for (const key of keys) {
    const before = previous?.[key];
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
