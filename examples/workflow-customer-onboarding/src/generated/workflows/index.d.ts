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
export type WorkflowName = "OnboardingRiskReview";
export interface OnboardingRiskReviewInput extends Record<string, unknown> {}
export interface OnboardingRiskReviewState {
  readonly accountId: string;
  readonly companyDomain: string;
  readonly crmAccount?: unknown;
  readonly billingProfile?: unknown;
  readonly identitySignals?: unknown;
  readonly riskScore: number;
  readonly provisioningPlan?: unknown;
  readonly approvedBy?: string;
  readonly slackMessage?: unknown;
}
export interface OnboardingRiskReviewRun {
  readonly workflow: "OnboardingRiskReview";
  readonly state: OnboardingRiskReviewState;
}
export type OnboardingRiskReviewStepName = "enrichAccount" | "scoreRisk" | "provisionWorkspace" | "notifyTeam";
export interface OnboardingRiskReviewEvent extends Record<string, unknown> {
  readonly source?: "product";
  readonly type?: "account.created";
}
export interface WorkflowInputByName {
  readonly "OnboardingRiskReview": OnboardingRiskReviewInput;
}
export interface WorkflowAccessors {
  readonly "OnboardingRiskReview": {
    enqueue(input: OnboardingRiskReviewInput): Promise<WorkflowRunRecord>;
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
