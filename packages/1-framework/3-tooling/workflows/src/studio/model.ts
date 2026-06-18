import type {
  WorkflowApprovalRecord,
  WorkflowCanvasIR,
  WorkflowDeadLetterRecord,
  WorkflowDefinitionIR,
  WorkflowExecutionOverlay,
  WorkflowExecutionOverlayNode,
  WorkflowIngestEventRecord,
  WorkflowManifest,
  WorkflowRunRecord,
  WorkflowStateSnapshotRecord,
  WorkflowStoreSnapshot,
  WorkflowTimelineEventRecord,
  WorkflowTimelineFrame,
} from '../shared/types';

export interface WorkflowStudioModel {
  readonly kind: 'prisma-workflow-studio-model';
  readonly version: 1;
  readonly workflows: readonly WorkflowStudioWorkflow[];
}

export interface WorkflowStudioWorkflow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly runsToday: number;
  readonly failureRate: number;
  readonly latestVersion: number;
  readonly canvas: WorkflowCanvasIR;
  readonly runs: readonly WorkflowRunRecord[];
  readonly approvals: readonly WorkflowApprovalRecord[];
  readonly ingestEvents: readonly WorkflowIngestEventRecord[];
  readonly deadLetters: readonly WorkflowDeadLetterRecord[];
  readonly overlays: readonly WorkflowExecutionOverlay[];
  readonly timelineFrames: readonly WorkflowTimelineFrame[];
}

export function buildWorkflowStudioModel(
  manifest: WorkflowManifest,
  snapshot?: WorkflowStoreSnapshot,
): WorkflowStudioModel {
  const runs = snapshot?.runs ?? [];
  const workflows = studioWorkflows(manifest, snapshot);
  const todayStart = startOfDay(new Date());
  return {
    kind: 'prisma-workflow-studio-model',
    version: 1,
    workflows: workflows.map((workflow) => {
      const workflowRuns = runs.filter((run) => run.workflowId === workflow.id);
      const failed = workflowRuns.filter((run) => run.status === 'failed').length;
      const latestVersion = Math.max(
        workflow.version,
        ...(snapshot?.versions
          .filter((version) => version.workflowId === workflow.id)
          .map((version) => version.version) ?? []),
      );
      return {
        id: workflow.id,
        name: workflow.name,
        slug: workflow.slug,
        latestVersion,
        runsToday: workflowRuns.filter((run) => dateValue(run.createdAt) >= todayStart.valueOf())
          .length,
        failureRate: workflowRuns.length === 0 ? 0 : failed / workflowRuns.length,
        canvas: workflow.canvas,
        runs: workflowRuns,
        approvals:
          snapshot?.approvals.filter((approval) =>
            workflowRuns.some((run) => run.id === approval.runId),
          ) ?? [],
        ingestEvents: snapshot?.ingestEvents ?? [],
        deadLetters: snapshot?.deadLetters ?? [],
        overlays: snapshot
          ? workflowRuns.map((run) => buildWorkflowExecutionOverlay(manifest, snapshot, run.id))
          : [],
        timelineFrames: snapshot
          ? workflowRuns.flatMap((run) => buildWorkflowTimelineFrames(manifest, snapshot, run.id))
          : [],
      };
    }),
  };
}

export function buildWorkflowExecutionOverlay(
  manifest: WorkflowManifest,
  snapshot: WorkflowStoreSnapshot,
  runId: string,
  sequence?: number,
): WorkflowExecutionOverlay {
  const run = snapshot.runs.find((candidate) => candidate.id === runId);
  const workflow = run ? workflowForStudioRun(manifest, snapshot, run) : undefined;
  const runTimeline = snapshot.timeline
    .filter((event) => event.runId === runId)
    .sort((a, b) => a.sequence - b.sequence);
  const timeline = runTimeline
    .filter(
      (event) => event.runId === runId && (sequence === undefined || event.sequence <= sequence),
    )
    .sort((a, b) => a.sequence - b.sequence);
  const latestSequence = timeline.at(-1)?.sequence ?? 0;
  const fullLatestSequence = runTimeline.at(-1)?.sequence ?? 0;
  const nodes: Record<string, WorkflowExecutionOverlayNode> = {};
  for (const node of workflow?.nodes ?? []) {
    nodes[node.id] = { status: 'not_started' };
  }
  const eventsByNode = eventsByNodeId(timeline);
  for (const step of snapshot.steps.filter((candidate) => candidate.runId === runId)) {
    const nodeEvents = eventsByNode.get(step.nodeId) ?? [];
    const latestStepEvent = [...nodeEvents]
      .reverse()
      .find((event) => stepEventTypes.has(event.type) || outboxEventTypes.has(event.type));
    if (!latestStepEvent) continue;
    const status = stepStatusAtEvent(step.status, latestStepEvent.type);
    const hasVisibleStart = nodeEvents.some((event) => stepStartEventTypes.has(event.type));
    const hasVisibleTerminal = stepTerminalEventTypes.has(latestStepEvent.type);
    const hasVisibleSuccess = stepSuccessEventTypes.has(latestStepEvent.type);
    const hasVisibleFailure = stepFailureEventTypes.has(latestStepEvent.type);
    const durationMs =
      hasVisibleTerminal && step.startedAt && step.completedAt
        ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
        : undefined;
    const stateDiff = snapshotForTimeline(snapshot.snapshots, timeline, runId, step.nodeId)?.diff;
    nodes[step.nodeId] = {
      status,
      attempt: step.attempt,
      ...(hasVisibleStart && step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
      ...(hasVisibleTerminal && step.completedAt !== undefined
        ? { completedAt: step.completedAt }
        : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(hasVisibleFailure && step.error !== undefined ? { error: step.error } : {}),
      ...(hasVisibleStart ? { inputRef: `${step.id}:input` } : {}),
      ...(hasVisibleSuccess ? { outputRef: `${step.id}:output` } : {}),
      ...(stateDiff !== undefined ? { stateDiff } : {}),
    };
  }
  for (const approval of snapshot.approvals.filter((candidate) => candidate.runId === runId)) {
    const latestApprovalEvent = [...(eventsByNode.get(approval.nodeId) ?? [])]
      .reverse()
      .find((event) => approvalEventTypes.has(event.type));
    if (!latestApprovalEvent) continue;
    const approvalResolved = approvalTerminalEventTypes.has(latestApprovalEvent.type);
    nodes[approval.nodeId] = {
      status: approvalStatusAtEvent(approval.status, latestApprovalEvent.type),
      startedAt: approval.requestedAt,
      ...(approvalResolved && approval.resolvedAt !== undefined
        ? { completedAt: approval.resolvedAt }
        : {}),
    };
  }
  for (const timer of snapshot.timers.filter((candidate) => candidate.runId === runId)) {
    const latestTimerEvent = [...(eventsByNode.get(timer.nodeId) ?? [])]
      .reverse()
      .find((event) => timerEventTypes.has(event.type));
    if (!latestTimerEvent) continue;
    nodes[timer.nodeId] = {
      status: latestTimerEvent.type === 'TIMER_RESUMED' ? 'succeeded' : 'waiting',
      startedAt: timer.createdAt,
      ...(latestTimerEvent.type === 'TIMER_RESUMED' ? { completedAt: timer.resumeAt } : {}),
    };
  }
  if (
    run?.currentNode &&
    nodes[run.currentNode]?.status === 'not_started' &&
    (sequence === undefined || sequence >= fullLatestSequence)
  ) {
    nodes[run.currentNode] = { status: run.status === 'running' ? 'running' : 'waiting' };
  }
  return { runId, sequence: latestSequence, nodes };
}

export function buildWorkflowTimelineFrames(
  manifest: WorkflowManifest,
  snapshot: WorkflowStoreSnapshot,
  runId: string,
): readonly WorkflowTimelineFrame[] {
  return snapshot.timeline
    .filter((event) => event.runId === runId)
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => {
      const stateSnapshot = visibleSnapshotForRun(
        snapshot.snapshots,
        snapshot.timeline,
        runId,
        event.sequence,
      );
      return {
        sequence: event.sequence,
        eventType: event.type,
        ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
        createdAt: event.createdAt,
        overlay: buildWorkflowExecutionOverlay(manifest, snapshot, runId, event.sequence),
        ...(stateSnapshot !== undefined ? { state: stateSnapshot.state } : {}),
        ...(stateSnapshot?.diff !== undefined ? { stateDiff: stateSnapshot.diff } : {}),
      };
    });
}

const stepEventTypes = new Set(['STEP_STARTED', 'STEP_COMPLETED', 'STEP_FAILED', 'STEP_RESTORED']);

const outboxEventTypes = new Set([
  'OUTBOX_PENDING',
  'OUTBOX_WAITING',
  'OUTBOX_DISPATCH_STARTED',
  'OUTBOX_DISPATCHED',
  'OUTBOX_DISPATCH_FAILED',
  'OUTBOX_RETRY_SCHEDULED',
]);

const stepStartEventTypes = new Set([
  'STEP_STARTED',
  'OUTBOX_PENDING',
  'OUTBOX_WAITING',
  'OUTBOX_DISPATCH_STARTED',
  'OUTBOX_RETRY_SCHEDULED',
]);

const stepTerminalEventTypes = new Set([
  'STEP_COMPLETED',
  'STEP_FAILED',
  'STEP_RESTORED',
  'OUTBOX_DISPATCHED',
  'OUTBOX_DISPATCH_FAILED',
]);

const stepSuccessEventTypes = new Set(['STEP_COMPLETED', 'STEP_RESTORED', 'OUTBOX_DISPATCHED']);

const stepFailureEventTypes = new Set(['STEP_FAILED', 'OUTBOX_DISPATCH_FAILED']);

const approvalEventTypes = new Set([
  'APPROVAL_REQUESTED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'APPROVAL_TIMED_OUT',
]);

const approvalTerminalEventTypes = new Set([
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'APPROVAL_TIMED_OUT',
]);

const timerEventTypes = new Set(['TIMER_WAITING', 'TIMER_RESUMED']);

function studioWorkflows(
  manifest: WorkflowManifest,
  snapshot: WorkflowStoreSnapshot | undefined,
): readonly WorkflowDefinitionIR[] {
  const byId = new Map<string, WorkflowDefinitionIR>();
  for (const workflow of manifest.workflows) {
    byId.set(workflow.id, workflow);
  }
  if (!snapshot) return [...byId.values()];
  const workflowIdsWithRuns = new Set(snapshot.runs.map((run) => run.workflowId));
  for (const version of snapshot.versions) {
    if (byId.has(version.workflowId) || !workflowIdsWithRuns.has(version.workflowId)) continue;
    byId.set(version.workflowId, version.compiledGraph);
  }
  return [...byId.values()];
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateValue(value: Date): number {
  return value instanceof Date ? value.valueOf() : new Date(value).valueOf();
}

function workflowForStudioRun(
  manifest: WorkflowManifest,
  snapshot: WorkflowStoreSnapshot,
  run: WorkflowRunRecord,
): WorkflowDefinitionIR | undefined {
  return (
    snapshot.versions.find((version) => version.id === run.versionId)?.compiledGraph ??
    manifest.workflows.find((workflow) => workflow.id === run.workflowId)
  );
}

function eventsByNodeId(
  timeline: readonly WorkflowTimelineEventRecord[],
): Map<string, WorkflowTimelineEventRecord[]> {
  const out = new Map<string, WorkflowTimelineEventRecord[]>();
  for (const event of timeline) {
    if (event.nodeId === undefined) continue;
    const existing = out.get(event.nodeId) ?? [];
    existing.push(event);
    out.set(event.nodeId, existing);
  }
  return out;
}

function stepStatusAtEvent(
  storedStatus: string,
  eventType: string,
): WorkflowExecutionOverlayNode['status'] {
  switch (eventType) {
    case 'STEP_COMPLETED':
    case 'STEP_RESTORED':
    case 'OUTBOX_DISPATCHED':
      return 'succeeded';
    case 'STEP_FAILED':
    case 'OUTBOX_DISPATCH_FAILED':
      return 'failed';
    case 'OUTBOX_PENDING':
    case 'OUTBOX_WAITING':
    case 'OUTBOX_RETRY_SCHEDULED':
      return 'waiting';
    case 'STEP_STARTED':
    case 'OUTBOX_DISPATCH_STARTED':
      return 'running';
    default:
      return storedStatus === 'skipped' ? 'skipped' : 'not_started';
  }
}

function approvalStatusAtEvent(
  storedStatus: WorkflowApprovalRecord['status'],
  eventType: string,
): WorkflowExecutionOverlayNode['status'] {
  switch (eventType) {
    case 'APPROVAL_REQUESTED':
      return 'waiting';
    case 'APPROVAL_APPROVED':
      return 'succeeded';
    case 'APPROVAL_REJECTED':
    case 'APPROVAL_TIMED_OUT':
      return 'failed';
    default:
      return storedStatus === 'pending'
        ? 'waiting'
        : storedStatus === 'approved'
          ? 'succeeded'
          : 'failed';
  }
}

function snapshotForTimeline(
  snapshots: readonly WorkflowStateSnapshotRecord[],
  timeline: readonly WorkflowTimelineEventRecord[],
  runId: string,
  nodeId: string,
): WorkflowStateSnapshotRecord | undefined {
  const visibleCompletionCount = timeline.filter(
    (event) =>
      event.runId === runId && event.nodeId === nodeId && snapshotEventTypes.has(event.type),
  ).length;
  if (visibleCompletionCount === 0) return undefined;
  return snapshots
    .filter((snapshot) => snapshot.runId === runId && snapshot.nodeId === nodeId)
    .sort((a, b) => a.sequence - b.sequence)
    .at(visibleCompletionCount - 1);
}

const snapshotEventTypes = new Set(['STEP_COMPLETED', 'STEP_RESTORED', 'OUTBOX_DISPATCHED']);

function visibleSnapshotForRun(
  snapshots: readonly WorkflowStateSnapshotRecord[],
  timeline: readonly WorkflowTimelineEventRecord[],
  runId: string,
  sequence: number,
): WorkflowStateSnapshotRecord | undefined {
  const visibleTimeline = timeline.filter(
    (event) => event.runId === runId && event.sequence <= sequence,
  );
  const byNode = new Map<string, WorkflowStateSnapshotRecord[]>();
  for (const snapshot of snapshots.filter((candidate) => candidate.runId === runId)) {
    if (snapshot.nodeId === undefined) continue;
    const nodeId = snapshot.nodeId;
    const existing = byNode.get(nodeId) ?? [];
    existing.push(snapshot);
    byNode.set(nodeId, existing);
  }
  const visible: WorkflowStateSnapshotRecord[] = [];
  for (const [nodeId, nodeSnapshots] of byNode) {
    const count = visibleTimeline.filter(
      (event) => event.nodeId === nodeId && snapshotEventTypes.has(event.type),
    ).length;
    if (count <= 0) continue;
    const snapshot = nodeSnapshots.sort((a, b) => a.sequence - b.sequence).at(count - 1);
    if (snapshot) visible.push(snapshot);
  }
  return visible.sort((a, b) => a.sequence - b.sequence).at(-1);
}
