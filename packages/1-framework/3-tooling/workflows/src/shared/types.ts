export type WorkflowNodeKind = 'trigger' | 'step' | 'approval' | 'condition' | 'timer' | 'parallel';

export type WorkflowSideEffectMode = 'none' | 'internal' | 'external';

export type WorkflowReplayMode = 'recorded' | 'resume' | 'reexecute' | 'fork';

export type WorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'waiting_for_timer'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkflowStepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped';

export type WorkflowApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface WorkflowRetryPolicy {
  readonly maxAttempts: number;
  readonly backoff: 'fixed' | 'exponential';
}

export interface WorkflowBudgetPolicy {
  readonly maxUsd?: number;
  readonly maxTokens?: number;
  readonly timeout?: string;
}

export interface WorkflowTriggerIR {
  readonly id: string;
  readonly kind: 'trigger';
  readonly name: string;
  readonly source: string;
  readonly connector?: string;
  readonly event: string;
  readonly dedupeBy?: string;
}

export interface WorkflowStepIR {
  readonly id: string;
  readonly kind: 'step';
  readonly name: string;
  readonly run: string;
  readonly timeout?: string;
  readonly checkpoint: boolean;
  readonly sideEffects: WorkflowSideEffectMode;
  readonly retry?: WorkflowRetryPolicy;
  readonly budget?: WorkflowBudgetPolicy;
  readonly idempotency?: string;
}

export interface WorkflowApprovalIR {
  readonly id: string;
  readonly kind: 'approval';
  readonly name: string;
  readonly when?: string;
  readonly timeout?: string;
  readonly assignees: readonly string[];
  readonly onApprove?: string;
  readonly onReject?: string;
  readonly onTimeout?: string;
}

export interface WorkflowConditionIR {
  readonly id: string;
  readonly kind: 'condition';
  readonly name: string;
  readonly when: string;
}

export interface WorkflowTimerIR {
  readonly id: string;
  readonly kind: 'timer';
  readonly name: string;
  readonly resumeAt?: string;
  readonly delay?: string;
}

export interface WorkflowParallelIR {
  readonly id: string;
  readonly kind: 'parallel';
  readonly name: string;
  readonly branches: readonly string[];
}

export type WorkflowExecutionNodeIR =
  | WorkflowStepIR
  | WorkflowApprovalIR
  | WorkflowConditionIR
  | WorkflowTimerIR
  | WorkflowParallelIR;

export interface WorkflowStateFieldIR {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly list: boolean;
  readonly id: boolean;
}

export interface WorkflowStateIR {
  readonly name: string;
  readonly fields: readonly WorkflowStateFieldIR[];
}

export interface WorkflowRetentionPolicyIR {
  readonly runHistoryDays?: number;
  readonly payloadDays?: number;
}

export interface WorkflowPoliciesIR {
  readonly maxRetries?: number;
  readonly timeout?: string;
  readonly budget?: WorkflowBudgetPolicy & {
    readonly maxRunsPerDay?: number;
  };
  readonly retention?: WorkflowRetentionPolicyIR;
}

export interface WorkflowConnectorBindingIR {
  readonly id: string;
  readonly connector: string;
  readonly accountId?: string;
  readonly events: readonly string[];
  readonly actions: readonly string[];
  readonly syncs: readonly string[];
}

export interface WorkflowCanvasNode {
  readonly id: string;
  readonly kind: WorkflowNodeKind | 'state';
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly sourceRef?: string;
  readonly codeRef?: string;
  readonly config?: Record<string, unknown>;
  readonly status?: WorkflowRunStatus | WorkflowStepStatus | WorkflowApprovalStatus;
}

export interface WorkflowCanvasEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface WorkflowCanvasIR {
  readonly nodes: readonly WorkflowCanvasNode[];
  readonly edges: readonly WorkflowCanvasEdge[];
}

export interface WorkflowDefinitionIR {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly version: number;
  readonly sourceHash: string;
  readonly triggers: readonly WorkflowTriggerIR[];
  readonly states: readonly WorkflowStateIR[];
  readonly nodes: readonly WorkflowExecutionNodeIR[];
  readonly policies: WorkflowPoliciesIR;
  readonly connectors: readonly WorkflowConnectorBindingIR[];
  readonly canvas: WorkflowCanvasIR;
}

export interface WorkflowManifest {
  readonly kind: 'prisma-workflow-manifest';
  readonly version: 1;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly schema: string;
  readonly workflows: readonly WorkflowDefinitionIR[];
}

export interface WorkflowDefinitionRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WorkflowVersionRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly version: number;
  readonly status: 'active' | 'retired';
  readonly sourceHash: string;
  readonly compiledGraph: WorkflowDefinitionIR;
  readonly visualGraph: WorkflowCanvasIR;
  readonly createdAt: Date;
}

export interface WorkflowIngestEventRecord {
  readonly id: string;
  readonly source: string;
  readonly connectorAccountId?: string;
  readonly externalId: string;
  readonly eventType: string;
  readonly dedupeKey: string;
  readonly occurredAt?: Date;
  readonly receivedAt: Date;
  readonly headers?: Record<string, string>;
  readonly rawPayload: unknown;
  readonly normalizedPayload?: unknown;
  readonly signatureVerified: boolean;
  readonly status: 'received' | 'matched' | 'ignored' | 'failed';
  readonly error?: string;
}

export interface WorkflowRunRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly ingestEventId?: string;
  readonly status: WorkflowRunStatus;
  readonly currentNode?: string | undefined;
  readonly input: unknown;
  readonly output?: unknown;
  readonly state: Record<string, unknown>;
  readonly error?: unknown;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WorkflowStepRunRecord {
  readonly id: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly stepName: string;
  readonly attempt: number;
  readonly status: WorkflowStepStatus;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly createdAt: Date;
}

export interface WorkflowTimelineEventRecord {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly nodeId?: string;
  readonly payload?: unknown;
  readonly createdAt: Date;
}

export interface WorkflowStateSnapshotRecord {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly nodeId?: string;
  readonly state: Record<string, unknown>;
  readonly diff?: unknown;
  readonly createdAt: Date;
}

export interface WorkflowApprovalRecord {
  readonly id: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly approvalName: string;
  readonly status: WorkflowApprovalStatus;
  readonly requestedAt: Date;
  readonly resolvedAt?: Date;
  readonly resolvedBy?: string;
  readonly decision?: unknown;
  readonly reason?: string;
  readonly assignees: readonly string[];
  readonly expiresAt?: Date;
  readonly payload?: unknown;
}

export interface WorkflowTriggerMatchRecord {
  readonly id: string;
  readonly ingestEventId: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly createdAt: Date;
}

export interface WorkflowLeaseRecord {
  readonly id: string;
  readonly resourceType: 'run' | 'step' | 'timer' | 'outbox';
  readonly resourceId: string;
  readonly workerId: string;
  readonly lockedUntil: Date;
  readonly heartbeatAt: Date;
}

export interface WorkflowTimerRecord {
  readonly id: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly resumeAt: Date;
  readonly status: 'scheduled' | 'ready' | 'completed' | 'cancelled';
  readonly payload?: unknown;
  readonly createdAt: Date;
}

export interface WorkflowOutboxRecord {
  readonly id: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly idempotencyKey?: string;
  readonly destination: string;
  readonly payload: unknown;
  readonly status: 'pending' | 'dispatched' | 'failed';
  readonly attempt?: number;
  readonly availableAt?: Date;
  readonly error?: unknown;
  readonly createdAt: Date;
  readonly dispatchedAt?: Date;
}

export interface WorkflowDeadLetterRecord {
  readonly id: string;
  readonly kind: 'event' | 'run' | 'step';
  readonly resourceId: string;
  readonly reason: string;
  readonly payload?: unknown;
  readonly createdAt: Date;
  readonly resolvedAt?: Date;
}

export interface WorkflowConnectorAccountRecord {
  readonly id: string;
  readonly connector: string;
  readonly label: string;
  readonly metadata?: unknown;
  readonly createdAt: Date;
}

export interface WorkflowConnectorCursorRecord {
  readonly id: string;
  readonly connector: string;
  readonly cursorKey: string;
  readonly cursorValue?: string;
  readonly updatedAt: Date;
}

export interface WorkflowCanvasLayoutRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly layout: WorkflowCanvasIR;
  readonly updatedAt: Date;
}

export interface WorkflowArtifactRecord {
  readonly id: string;
  readonly runId?: string;
  readonly kind: string;
  readonly uri?: string;
  readonly payload?: unknown;
  readonly createdAt: Date;
}

export type WorkflowOverlayNodeStatus =
  | 'not_started'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'waiting'
  | 'skipped';

export interface WorkflowExecutionOverlayNode {
  readonly status: WorkflowOverlayNodeStatus;
  readonly attempt?: number;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly durationMs?: number;
  readonly error?: unknown;
  readonly inputRef?: string;
  readonly outputRef?: string;
  readonly stateDiff?: unknown;
}

export interface WorkflowExecutionOverlay {
  readonly runId: string;
  readonly sequence: number;
  readonly nodes: Record<string, WorkflowExecutionOverlayNode>;
}

export interface WorkflowTimelineFrame {
  readonly sequence: number;
  readonly eventType: string;
  readonly nodeId?: string;
  readonly createdAt: Date;
  readonly overlay: WorkflowExecutionOverlay;
  readonly state?: Record<string, unknown>;
  readonly stateDiff?: unknown;
}

export interface WorkflowStoreSnapshot {
  readonly definitions: readonly WorkflowDefinitionRecord[];
  readonly versions: readonly WorkflowVersionRecord[];
  readonly ingestEvents: readonly WorkflowIngestEventRecord[];
  readonly triggerMatches: readonly WorkflowTriggerMatchRecord[];
  readonly runs: readonly WorkflowRunRecord[];
  readonly steps: readonly WorkflowStepRunRecord[];
  readonly timeline: readonly WorkflowTimelineEventRecord[];
  readonly snapshots: readonly WorkflowStateSnapshotRecord[];
  readonly approvals: readonly WorkflowApprovalRecord[];
  readonly leases: readonly WorkflowLeaseRecord[];
  readonly timers: readonly WorkflowTimerRecord[];
  readonly outbox: readonly WorkflowOutboxRecord[];
  readonly deadLetters: readonly WorkflowDeadLetterRecord[];
  readonly connectorAccounts: readonly WorkflowConnectorAccountRecord[];
  readonly connectorCursors: readonly WorkflowConnectorCursorRecord[];
  readonly canvasLayouts: readonly WorkflowCanvasLayoutRecord[];
  readonly artifacts: readonly WorkflowArtifactRecord[];
}
