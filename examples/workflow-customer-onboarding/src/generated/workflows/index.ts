import {
  createWorkflowClient,
  createWorkflowRuntime,
} from '@prisma-next/workflows/runtime';
import type { WorkflowManifest } from '@prisma-next/workflows';
import type { WorkflowReplayOptions, WorkflowRunInclude } from '@prisma-next/workflows/runtime';

export const manifest = {
  "kind": "prisma-workflow-manifest",
  "schema": "generator workflows {\n  provider = \"prisma-workflows\"\n  output   = \"./generated/workflows\"\n  schema   = \"_prisma_workflows\"\n}\n\nmodel OnboardingCase {\n  id            String   @id\n  accountId     String\n  companyDomain String\n  riskScore     Float\n  status        String\n  approvedBy    String?\n  createdAt     DateTime\n  updatedAt     DateTime\n}\n\nworkflow OnboardingRiskReview {\n  trigger accountCreated {\n    source = \"product\"\n    event = \"account.created\"\n    dedupeBy = \"event.accountId\"\n  }\n\n  state OnboardingState {\n    accountId String @id\n    companyDomain String\n    crmAccount Json?\n    billingProfile Json?\n    identitySignals Json?\n    riskScore Float\n    provisioningPlan Json?\n    approvedBy String?\n    slackMessage Json?\n  }\n\n  step enrichAccount {\n    run = \"./src/steps/enrich-account.ts\"\n    checkpoint = true\n  }\n\n  step scoreRisk {\n    run = \"./src/steps/score-risk.ts\"\n    checkpoint = true\n  }\n\n  approval salesOpsApproval {\n    when = \"state.riskScore > 0.7\"\n    assignees = [\"role:sales_ops\"]\n    timeout = \"24h\"\n    onApprove = provisionWorkspace\n  }\n\n  step provisionWorkspace {\n    run = \"./src/steps/provision-workspace.ts\"\n    checkpoint = true\n    sideEffects = \"external\"\n    idempotency = \"state.accountId\"\n  }\n\n  step notifyTeam {\n    run = \"./src/steps/notify-team.ts\"\n    sideEffects = \"external\"\n    idempotency = \"state.accountId\"\n  }\n}\n",
  "sourceHash": "sha256:3406000150ebd67994c6be5b4349b08d790f7efad81852edc7742e6f5f8eba9d",
  "sourceId": "src/schema.prisma",
  "version": 1,
  "workflows": [
    {
      "canvas": {
        "edges": [
          {
            "from": "trigger:accountCreated",
            "id": "OnboardingRiskReview:edge:0",
            "to": "step:enrichAccount"
          },
          {
            "from": "step:enrichAccount",
            "id": "OnboardingRiskReview:edge:1",
            "to": "step:scoreRisk"
          },
          {
            "from": "step:scoreRisk",
            "id": "OnboardingRiskReview:edge:2",
            "to": "approval:salesOpsApproval"
          },
          {
            "from": "approval:salesOpsApproval",
            "id": "OnboardingRiskReview:edge:3",
            "to": "step:provisionWorkspace"
          },
          {
            "from": "step:provisionWorkspace",
            "id": "OnboardingRiskReview:edge:4",
            "to": "step:notifyTeam"
          },
          {
            "from": "approval:salesOpsApproval",
            "id": "OnboardingRiskReview:approval:salesOpsApproval:approve",
            "label": "approve",
            "to": "step:provisionWorkspace"
          }
        ],
        "nodes": [
          {
            "config": {
              "dedupeBy": "event.accountId",
              "event": "account.created"
            },
            "id": "trigger:accountCreated",
            "kind": "trigger",
            "label": "accountCreated",
            "sourceRef": "product",
            "x": 80,
            "y": 80
          },
          {
            "id": "state:OnboardingState",
            "kind": "state",
            "label": "OnboardingState",
            "x": 80,
            "y": 260
          },
          {
            "codeRef": "./src/steps/enrich-account.ts",
            "config": {
              "checkpoint": true,
              "sideEffects": "internal"
            },
            "id": "step:enrichAccount",
            "kind": "step",
            "label": "enrichAccount",
            "x": 320,
            "y": 140
          },
          {
            "codeRef": "./src/steps/score-risk.ts",
            "config": {
              "checkpoint": true,
              "sideEffects": "internal"
            },
            "id": "step:scoreRisk",
            "kind": "step",
            "label": "scoreRisk",
            "x": 540,
            "y": 140
          },
          {
            "config": {
              "assignees": [
                "role:sales_ops"
              ],
              "onApprove": "provisionWorkspace",
              "timeout": "24h",
              "when": "state.riskScore > 0.7"
            },
            "id": "approval:salesOpsApproval",
            "kind": "approval",
            "label": "salesOpsApproval",
            "x": 760,
            "y": 140
          },
          {
            "codeRef": "./src/steps/provision-workspace.ts",
            "config": {
              "checkpoint": true,
              "idempotency": "state.accountId",
              "sideEffects": "external"
            },
            "id": "step:provisionWorkspace",
            "kind": "step",
            "label": "provisionWorkspace",
            "x": 980,
            "y": 140
          },
          {
            "codeRef": "./src/steps/notify-team.ts",
            "config": {
              "checkpoint": false,
              "idempotency": "state.accountId",
              "sideEffects": "external"
            },
            "id": "step:notifyTeam",
            "kind": "step",
            "label": "notifyTeam",
            "x": 1200,
            "y": 140
          }
        ]
      },
      "connectors": [
        {
          "actions": [],
          "connector": "product",
          "events": [
            "account.created"
          ],
          "id": "product",
          "syncs": []
        }
      ],
      "id": "onboarding-risk-review",
      "name": "OnboardingRiskReview",
      "nodes": [
        {
          "checkpoint": true,
          "id": "step:enrichAccount",
          "kind": "step",
          "name": "enrichAccount",
          "run": "./src/steps/enrich-account.ts",
          "sideEffects": "internal"
        },
        {
          "checkpoint": true,
          "id": "step:scoreRisk",
          "kind": "step",
          "name": "scoreRisk",
          "run": "./src/steps/score-risk.ts",
          "sideEffects": "internal"
        },
        {
          "assignees": [
            "role:sales_ops"
          ],
          "id": "approval:salesOpsApproval",
          "kind": "approval",
          "name": "salesOpsApproval",
          "onApprove": "provisionWorkspace",
          "timeout": "24h",
          "when": "state.riskScore > 0.7"
        },
        {
          "checkpoint": true,
          "id": "step:provisionWorkspace",
          "idempotency": "state.accountId",
          "kind": "step",
          "name": "provisionWorkspace",
          "run": "./src/steps/provision-workspace.ts",
          "sideEffects": "external"
        },
        {
          "checkpoint": false,
          "id": "step:notifyTeam",
          "idempotency": "state.accountId",
          "kind": "step",
          "name": "notifyTeam",
          "run": "./src/steps/notify-team.ts",
          "sideEffects": "external"
        }
      ],
      "policies": {},
      "slug": "onboarding-risk-review",
      "sourceHash": "sha256:8c95e22903a5e821ffd7ce0c5f1cb071dff160ca505249cae5bfb2abc20aed10",
      "states": [
        {
          "fields": [
            {
              "id": true,
              "list": false,
              "name": "accountId",
              "optional": false,
              "type": "String"
            },
            {
              "id": false,
              "list": false,
              "name": "companyDomain",
              "optional": false,
              "type": "String"
            },
            {
              "id": false,
              "list": false,
              "name": "crmAccount",
              "optional": true,
              "type": "Json"
            },
            {
              "id": false,
              "list": false,
              "name": "billingProfile",
              "optional": true,
              "type": "Json"
            },
            {
              "id": false,
              "list": false,
              "name": "identitySignals",
              "optional": true,
              "type": "Json"
            },
            {
              "id": false,
              "list": false,
              "name": "riskScore",
              "optional": false,
              "type": "Float"
            },
            {
              "id": false,
              "list": false,
              "name": "provisioningPlan",
              "optional": true,
              "type": "Json"
            },
            {
              "id": false,
              "list": false,
              "name": "approvedBy",
              "optional": true,
              "type": "String"
            },
            {
              "id": false,
              "list": false,
              "name": "slackMessage",
              "optional": true,
              "type": "Json"
            }
          ],
          "name": "OnboardingState"
        }
      ],
      "triggers": [
        {
          "dedupeBy": "event.accountId",
          "event": "account.created",
          "id": "trigger:accountCreated",
          "kind": "trigger",
          "name": "accountCreated",
          "source": "product"
        }
      ],
      "version": 211149355
    }
  ]
} as const satisfies WorkflowManifest;

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

export function workflowRuntime(options = {}) {
  return createWorkflowRuntime({ manifest, ...options });
}

export function workflowClient(options = {}) {
  const client = createWorkflowClient(workflowRuntime(options));
  return Object.assign(client, {
    workflows: {
      "OnboardingRiskReview": {
        enqueue: (input: unknown) => client.enqueue("OnboardingRiskReview", input),
        inspect: (runId: string, input?: { include?: WorkflowRunInclude }) => client.run.findUnique({ where: { id: runId }, ...(input ?? {}) }),
        replay: (runId: string, options?: WorkflowReplayOptions) => client.replay(runId, options),
      }
    },
  });
}

export function workflows(options = {}) {
  const client = workflowClient(options);
  return {
    name: 'prisma-workflows',
    client: {
      workflow: client,
    },
  };
}
