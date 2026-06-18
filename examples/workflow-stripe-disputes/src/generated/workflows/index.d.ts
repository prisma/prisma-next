import type {
  WorkflowClient,
  WorkflowReplayOptions,
  WorkflowRunInclude,
  WorkflowRunWithInclude,
  WorkflowRuntime,
} from '@prisma-next/workflows/runtime';
import type { WorkflowRunRecord } from '@prisma-next/workflows';
import type { WorkflowManifest } from '@prisma-next/workflows';
export declare const manifest: WorkflowManifest;
export type WorkflowName = "DisputeEvidence";
export interface DisputeEvidenceInput extends Record<string, unknown> {}
export interface DisputeEvidenceState {
  readonly disputeId: string;
  readonly customerId: string;
  readonly customerEmail?: string;
  readonly amount: number;
  readonly currency: string;
  readonly reason: string;
  readonly hubspotHistory?: unknown;
  readonly shopifyOrders?: unknown;
  readonly zendeskTickets?: unknown;
  readonly stripeMetadata?: unknown;
  readonly draftResponse?: string;
  readonly approvedBy?: string;
  readonly evidenceId?: string;
}
export interface DisputeEvidenceRun {
  readonly workflow: "DisputeEvidence";
  readonly state: DisputeEvidenceState;
}
export type DisputeEvidenceStepName = "collectCustomerHistory" | "draftResponse" | "submitEvidence" | "postSummary" | "learnFromApproval";
export interface DisputeEvidenceEvent extends Record<string, unknown> {
  readonly source?: "stripe";
  readonly type?: "charge.dispute.created";
}
export interface WorkflowInputByName {
  readonly "DisputeEvidence": DisputeEvidenceInput;
}
export interface WorkflowAccessors {
  readonly "DisputeEvidence": {
    enqueue(input: DisputeEvidenceInput): Promise<WorkflowRunRecord>;
    inspect(runId: string, input?: { readonly include?: WorkflowRunInclude }): Promise<WorkflowRunWithInclude | undefined>;
    replay(runId: string, options?: WorkflowReplayOptions): Promise<WorkflowRunRecord>;
  };
}
export type TypedWorkflowClient = Omit<WorkflowClient, 'enqueue'> & {
  enqueue<N extends WorkflowName>(workflowName: N, input: WorkflowInputByName[N]): Promise<WorkflowRunRecord>;
  readonly workflows: WorkflowAccessors;
};
export declare function workflowRuntime(options?: Record<string, unknown>): WorkflowRuntime;
export declare function workflowClient(options?: Record<string, unknown>): TypedWorkflowClient;
export declare function workflows(options?: Record<string, unknown>): {
  readonly name: 'prisma-workflows';
  readonly client: {
    readonly workflow: TypedWorkflowClient;
  };
};
