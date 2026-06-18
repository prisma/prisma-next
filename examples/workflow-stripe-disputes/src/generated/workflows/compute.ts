import {
  createWorkflowHttpApp,
  PostgresWorkflowStore,
  type WorkflowStepHandler,
} from '@prisma-next/workflows/runtime';
import type { ConnectorDefinition } from '@prisma-next/workflows/connector-sdk';
import * as stepModule1 from "../../steps/collect-customer-history";
import * as stepModule2 from "../../steps/draft-response";
import * as stepModule3 from "../../steps/submit-evidence";
import * as stepModule4 from "../../steps/post-summary";
import * as stepModule5 from "../../steps/learn-from-approved-response";
import { manifest } from './index';

type StepModule = {
  readonly default?: WorkflowStepHandler | undefined;
  readonly run?: WorkflowStepHandler | undefined;
  readonly handler?: WorkflowStepHandler | undefined;
  readonly step?: WorkflowStepHandler | undefined;
};


export interface WorkflowComputeAppOptions {
  readonly connectors?: Record<string, ConnectorDefinition>;
  readonly secrets?: Record<string, string | undefined>;
  readonly steps?: Record<string, WorkflowStepHandler>;
  readonly store?: PostgresWorkflowStore;
}

const steps: Record<string, WorkflowStepHandler> = {
  "collectCustomerHistory": pickStep(stepModule1, "collectCustomerHistory"),
  "./src/steps/collect-customer-history.ts": pickStep(stepModule1, "collectCustomerHistory"),
  "draftResponse": pickStep(stepModule2, "draftResponse"),
  "./src/steps/draft-response.ts": pickStep(stepModule2, "draftResponse"),
  "submitEvidence": pickStep(stepModule3, "submitEvidence"),
  "./src/steps/submit-evidence.ts": pickStep(stepModule3, "submitEvidence"),
  "postSummary": pickStep(stepModule4, "postSummary"),
  "./src/steps/post-summary.ts": pickStep(stepModule4, "postSummary"),
  "learnFromApproval": pickStep(stepModule5, "learnFromApproval"),
  "./src/steps/learn-from-approved-response.ts": pickStep(stepModule5, "learnFromApproval"),
};
const connectors: Record<string, ConnectorDefinition> = {};
const connectionString = process.env['DATABASE_URL'];
const store = connectionString
  ? new PostgresWorkflowStore({ connectionString, schemaName: "_prisma_workflows" })
  : undefined;

export function createApp(options: WorkflowComputeAppOptions = {}) {
  const resolvedStore = options.store ?? store;
  return createWorkflowHttpApp({
    manifest,
    steps: { ...steps, ...(options.steps ?? {}) },
    connectors: { ...connectors, ...(options.connectors ?? {}) },
    ...(options.secrets ? { secrets: options.secrets } : {}),
    ...(resolvedStore ? { store: resolvedStore } : {}),
  });
}

export const app = createApp();
export default app;

function pickStep(moduleValue: StepModule, stepName: string): WorkflowStepHandler {
  const handler = moduleValue.default ?? moduleValue.run ?? moduleValue.handler ?? moduleValue.step;
  if (!handler) {
    throw new Error(`Workflow step module for "${stepName}" must export default, run, handler, or step.`);
  }
  return handler;
}

