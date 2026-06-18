import {
  createWorkflowClient,
  createWorkflowRuntime,
} from '@prisma-next/workflows/runtime';
import type { WorkflowManifest } from '@prisma-next/workflows';
import type { WorkflowReplayOptions, WorkflowRunInclude } from '@prisma-next/workflows/runtime';

export const manifest = {
  "kind": "prisma-workflow-manifest",
  "schema": "generator workflows {\n  provider = \"prisma-workflows\"\n  output   = \"./generated/workflows\"\n  schema   = \"_prisma_workflows\"\n}\n\nmodel DisputeCase {\n  id               String   @id\n  stripeDisputeId  String\n  amountCents      Int\n  customerEmail    String\n  status           String\n  draftResponse    String?\n  approvedResponse String?\n  evidenceId       String?\n  createdAt        DateTime\n  updatedAt        DateTime\n}\n\nmodel ApprovedDisputeResponse {\n  id              String   @id\n  disputeReason   String\n  amountCents     Int\n  response        String\n  confidence      Float\n  approvedBy      String\n  createdAt       DateTime\n}\n\nworkflow DisputeEvidence {\n  trigger stripeDisputeCreated {\n    source = \"stripe\"\n    event = \"charge.dispute.created\"\n    dedupeBy = \"event.data.object.id\"\n  }\n\n  state DisputeCaseState {\n    disputeId String @id\n    customerId String\n    customerEmail String?\n    amount Int\n    currency String\n    reason String\n    hubspotHistory Json?\n    shopifyOrders Json?\n    zendeskTickets Json?\n    stripeMetadata Json?\n    draftResponse String?\n    approvedBy String?\n    evidenceId String?\n  }\n\n  step collectCustomerHistory {\n    run = \"./src/steps/collect-customer-history.ts\"\n    checkpoint = true\n    retry = { maxAttempts: 3, backoff: \"exponential\" }\n  }\n\n  step draftResponse {\n    run = \"./src/steps/draft-response.ts\"\n    checkpoint = true\n    budget = { maxUsd: 1.25, maxTokens: 2000, timeout: \"45s\" }\n  }\n\n  approval humanApproval {\n    when = \"state.amount > 50000\"\n    assignees = [\"role:finance_ops\"]\n    timeout = \"48h\"\n    onApprove = submitEvidence\n  }\n\n  step submitEvidence {\n    run = \"./src/steps/submit-evidence.ts\"\n    checkpoint = true\n    sideEffects = \"external\"\n    idempotency = \"state.disputeId\"\n  }\n\n  step postSummary {\n    run = \"./src/steps/post-summary.ts\"\n    sideEffects = \"external\"\n    idempotency = \"state.disputeId\"\n  }\n\n  step learnFromApproval {\n    run = \"./src/steps/learn-from-approved-response.ts\"\n    checkpoint = true\n  }\n}\n",
  "sourceHash": "sha256:d117e5baa93f4a89f000366cf5c2cd63b9cbd8860eb9a817c690d9aebe73d325",
  "sourceId": "src/schema.prisma",
  "version": 1,
  "workflows": [
    {
      "canvas": {
        "edges": [
          {
            "from": "trigger:stripeDisputeCreated",
            "id": "DisputeEvidence:edge:0",
            "to": "step:collectCustomerHistory"
          },
          {
            "from": "step:collectCustomerHistory",
            "id": "DisputeEvidence:edge:1",
            "to": "step:draftResponse"
          },
          {
            "from": "step:draftResponse",
            "id": "DisputeEvidence:edge:2",
            "to": "approval:humanApproval"
          },
          {
            "from": "approval:humanApproval",
            "id": "DisputeEvidence:edge:3",
            "to": "step:submitEvidence"
          },
          {
            "from": "step:submitEvidence",
            "id": "DisputeEvidence:edge:4",
            "to": "step:postSummary"
          },
          {
            "from": "step:postSummary",
            "id": "DisputeEvidence:edge:5",
            "to": "step:learnFromApproval"
          },
          {
            "from": "approval:humanApproval",
            "id": "DisputeEvidence:approval:humanApproval:approve",
            "label": "approve",
            "to": "step:submitEvidence"
          }
        ],
        "nodes": [
          {
            "config": {
              "dedupeBy": "event.data.object.id",
              "event": "charge.dispute.created"
            },
            "id": "trigger:stripeDisputeCreated",
            "kind": "trigger",
            "label": "stripeDisputeCreated",
            "sourceRef": "stripe",
            "x": 80,
            "y": 80
          },
          {
            "id": "state:DisputeCaseState",
            "kind": "state",
            "label": "DisputeCaseState",
            "x": 80,
            "y": 260
          },
          {
            "codeRef": "./src/steps/collect-customer-history.ts",
            "config": {
              "checkpoint": true,
              "retry": {
                "backoff": "exponential",
                "maxAttempts": 3
              },
              "sideEffects": "internal"
            },
            "id": "step:collectCustomerHistory",
            "kind": "step",
            "label": "collectCustomerHistory",
            "x": 320,
            "y": 140
          },
          {
            "codeRef": "./src/steps/draft-response.ts",
            "config": {
              "budget": {
                "maxTokens": 2000,
                "maxUsd": 1.25,
                "timeout": "45s"
              },
              "checkpoint": true,
              "sideEffects": "internal"
            },
            "id": "step:draftResponse",
            "kind": "step",
            "label": "draftResponse",
            "x": 540,
            "y": 140
          },
          {
            "config": {
              "assignees": [
                "role:finance_ops"
              ],
              "onApprove": "submitEvidence",
              "timeout": "48h",
              "when": "state.amount > 50000"
            },
            "id": "approval:humanApproval",
            "kind": "approval",
            "label": "humanApproval",
            "x": 760,
            "y": 140
          },
          {
            "codeRef": "./src/steps/submit-evidence.ts",
            "config": {
              "checkpoint": true,
              "idempotency": "state.disputeId",
              "sideEffects": "external"
            },
            "id": "step:submitEvidence",
            "kind": "step",
            "label": "submitEvidence",
            "x": 980,
            "y": 140
          },
          {
            "codeRef": "./src/steps/post-summary.ts",
            "config": {
              "checkpoint": false,
              "idempotency": "state.disputeId",
              "sideEffects": "external"
            },
            "id": "step:postSummary",
            "kind": "step",
            "label": "postSummary",
            "x": 1200,
            "y": 140
          },
          {
            "codeRef": "./src/steps/learn-from-approved-response.ts",
            "config": {
              "checkpoint": true,
              "sideEffects": "internal"
            },
            "id": "step:learnFromApproval",
            "kind": "step",
            "label": "learnFromApproval",
            "x": 1420,
            "y": 140
          }
        ]
      },
      "connectors": [
        {
          "actions": [],
          "connector": "stripe",
          "events": [
            "charge.dispute.created"
          ],
          "id": "stripe",
          "syncs": []
        }
      ],
      "id": "dispute-evidence",
      "name": "DisputeEvidence",
      "nodes": [
        {
          "checkpoint": true,
          "id": "step:collectCustomerHistory",
          "kind": "step",
          "name": "collectCustomerHistory",
          "retry": {
            "backoff": "exponential",
            "maxAttempts": 3
          },
          "run": "./src/steps/collect-customer-history.ts",
          "sideEffects": "internal"
        },
        {
          "budget": {
            "maxTokens": 2000,
            "maxUsd": 1.25,
            "timeout": "45s"
          },
          "checkpoint": true,
          "id": "step:draftResponse",
          "kind": "step",
          "name": "draftResponse",
          "run": "./src/steps/draft-response.ts",
          "sideEffects": "internal"
        },
        {
          "assignees": [
            "role:finance_ops"
          ],
          "id": "approval:humanApproval",
          "kind": "approval",
          "name": "humanApproval",
          "onApprove": "submitEvidence",
          "timeout": "48h",
          "when": "state.amount > 50000"
        },
        {
          "checkpoint": true,
          "id": "step:submitEvidence",
          "idempotency": "state.disputeId",
          "kind": "step",
          "name": "submitEvidence",
          "run": "./src/steps/submit-evidence.ts",
          "sideEffects": "external"
        },
        {
          "checkpoint": false,
          "id": "step:postSummary",
          "idempotency": "state.disputeId",
          "kind": "step",
          "name": "postSummary",
          "run": "./src/steps/post-summary.ts",
          "sideEffects": "external"
        },
        {
          "checkpoint": true,
          "id": "step:learnFromApproval",
          "kind": "step",
          "name": "learnFromApproval",
          "run": "./src/steps/learn-from-approved-response.ts",
          "sideEffects": "internal"
        }
      ],
      "policies": {
        "maxRetries": 3
      },
      "slug": "dispute-evidence",
      "sourceHash": "sha256:dd7c1952d143938e71ed8da185ba6483d783539f3c25a8fc602e93836aa29738",
      "states": [
        {
          "fields": [
            {
              "id": true,
              "list": false,
              "name": "disputeId",
              "optional": false,
              "type": "String"
            },
            {
              "id": false,
              "list": false,
              "name": "customerId",
              "optional": false,
              "type": "String"
            },
            {
              "id": false,
              "list": false,
              "name": "customerEmail",
              "optional": true,
              "type": "String"
            },
            {
              "id": false,
              "list": false,
              "name": "amount",
              "optional": false,
              "type": "Int"
            },
            {
              "id": false,
              "list": false,
              "name": "currency",
              "optional": false,
              "type": "String"
            },
            {
              "id": false,
              "list": false,
              "name": "reason",
              "optional": false,
              "type": "String"
            },
            {
              "id": false,
              "list": false,
              "name": "hubspotHistory",
              "optional": true,
              "type": "Json"
            },
            {
              "id": false,
              "list": false,
              "name": "shopifyOrders",
              "optional": true,
              "type": "Json"
            },
            {
              "id": false,
              "list": false,
              "name": "zendeskTickets",
              "optional": true,
              "type": "Json"
            },
            {
              "id": false,
              "list": false,
              "name": "stripeMetadata",
              "optional": true,
              "type": "Json"
            },
            {
              "id": false,
              "list": false,
              "name": "draftResponse",
              "optional": true,
              "type": "String"
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
              "name": "evidenceId",
              "optional": true,
              "type": "String"
            }
          ],
          "name": "DisputeCaseState"
        }
      ],
      "triggers": [
        {
          "dedupeBy": "event.data.object.id",
          "event": "charge.dispute.created",
          "id": "trigger:stripeDisputeCreated",
          "kind": "trigger",
          "name": "stripeDisputeCreated",
          "source": "stripe"
        }
      ],
      "version": 1568414036
    }
  ]
} as const satisfies WorkflowManifest;

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

export function workflowRuntime(options = {}) {
  return createWorkflowRuntime({ manifest, ...options });
}

export function workflowClient(options = {}) {
  const client = createWorkflowClient(workflowRuntime(options));
  return Object.assign(client, {
    workflows: {
      "DisputeEvidence": {
        enqueue: (input: unknown) => client.enqueue("DisputeEvidence", input),
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
