import {
  createWorkflowHttpApp,
  PostgresWorkflowStore,
  type WorkflowStepHandler,
} from '@prisma-next/workflows/runtime';
import type { ConnectorDefinition } from '@prisma-next/workflows/connector-sdk';
import * as stepModule1 from "../../steps/enrich-account";
import * as stepModule2 from "../../steps/score-risk";
import * as stepModule3 from "../../steps/provision-workspace";
import * as stepModule4 from "../../steps/notify-team";
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
  "enrichAccount": pickStep(stepModule1, "enrichAccount"),
  "./src/steps/enrich-account.ts": pickStep(stepModule1, "enrichAccount"),
  "scoreRisk": pickStep(stepModule2, "scoreRisk"),
  "./src/steps/score-risk.ts": pickStep(stepModule2, "scoreRisk"),
  "provisionWorkspace": pickStep(stepModule3, "provisionWorkspace"),
  "./src/steps/provision-workspace.ts": pickStep(stepModule3, "provisionWorkspace"),
  "notifyTeam": pickStep(stepModule4, "notifyTeam"),
  "./src/steps/notify-team.ts": pickStep(stepModule4, "notifyTeam"),
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

