Yes, this is a good split — with one important adjustment:

**Prisma Workflows should be the database-backed workflow substrate, not the whole n8n competitor.**

That means Prisma Tooling should own the parts that are naturally “Prisma-shaped”:

* workflow schema / manifest
* generated types
* generated Prisma Client extensions
* durable Postgres tables for event ingest, runs, steps, state, history, approvals, retries, leases, and replay
* local development
* migrations
* Studio/canvas inspection
* connector SDK primitives
* deployment hooks into Prisma Compute

Your n8n competitor should own the higher-level product:

* natural-language workflow authoring
* n8n import/migration
* hosted visual builder
* templates
* marketplace
* enterprise admin
* billing
* team collaboration
* hosted connector OAuth
* migration concierge
* AI workflow generation/evaluation

The clean framing is:

> **Prisma Workflows is the runtime and data plane. Your product is the agent-native automation control plane.**

That split is strong because it gives Prisma a coherent extension of its existing strengths: schema, migrations, type-safe client generation, Studio, Postgres, MCP, and Compute. Prisma ORM already positions the schema as the source of truth for data models, Prisma Migrate as the database migration layer, Prisma Client as the generated type-safe interface, and Prisma Studio as a GUI for data. Prisma Workflows would extend that same pattern to durable workflows. ([Prisma][1])

---

# 1. What Prisma Workflows should be

**Prisma Workflows should make workflows a first-class, database-backed application primitive.**

Not “Zapier inside Prisma.”

Not “n8n inside Prisma.”

Not “a canvas app.”

Instead:

> Define workflows next to your data model, generate type-safe workflow code, run executions durably through Postgres, inspect them visually, replay them, and deploy them to Prisma Compute.

The product promise:

```txt
schema.prisma defines your data.
workflow.prisma defines how your data changes over time.
Prisma Migrate creates the backing tables.
Prisma Client runs and inspects workflows.
Prisma Studio visualizes workflow state and history.
Prisma Compute deploys the runtime.
```

That gives Prisma a very natural expansion path.

Prisma Compute is especially relevant because it runs TypeScript apps as long-lived Bun processes next to Prisma Postgres, with support for APIs, AI agents, long-running HTTP requests, streaming, and co-located database access. But Prisma’s own Compute page currently marks background workers, cron, and WebSocket servers as “coming soon,” so the initial Workflows runtime should be backed by Postgres leases/queues rather than assuming native Compute workers exist everywhere on day one. ([Prisma][2])

---

# 2. The right product boundary

I would split the system like this:

| Layer                             | Owned by Prisma Workflows     | Owned by your n8n competitor    |
| --------------------------------- | ----------------------------- | ------------------------------- |
| Workflow schema / IR              | Yes                           | Uses/generates it               |
| Durable execution tables          | Yes                           | Uses them                       |
| Event ingest tables               | Yes                           | Uses them                       |
| Workflow runtime SDK              | Yes                           | Uses/extends it                 |
| Local dev runner                  | Yes                           | Uses it                         |
| Prisma Studio workflow inspector  | Yes                           | May embed/deep-link             |
| Basic canvas rendering            | Yes                           | Advanced builder UX             |
| Connector SDK                     | Yes                           | Marketplace + hosted connectors |
| First-party reference connectors  | Limited                       | Broad connector catalog         |
| Natural-language workflow builder | Maybe via MCP hooks, not core | Yes                             |
| n8n importer                      | No, except shared IR helps    | Yes                             |
| Enterprise workflow governance    | Some primitives               | Full product                    |
| Billing/usage/collaboration       | No                            | Yes                             |
| Templates                         | Maybe examples                | Yes                             |
| Migration concierge               | No                            | Yes                             |

The key is that **Prisma Workflows should be useful even to a developer who never uses your hosted product**.

A developer should be able to install it and say:

```bash
npx prisma workflow init
npx prisma migrate dev
npx prisma workflow dev
```

Then define a Stripe-backed workflow, ingest events, run executions, inspect history, and replay failures.

Your company then builds the magical product on top: describe what you want, generate the workflow, migrate from n8n, deploy it, monitor it, and operate it with a beautiful control plane.

---

# 3. Why this is strategically smart

n8n already has the canvas, execution history, webhooks, many nodes, custom node creation, and debugging flows. Its docs describe workflow-level executions, workflow history, webhook triggers, built-in integrations, community nodes, and custom node development. ([docs.n8n.io][3])

So Prisma Workflows should not compete feature-for-feature with n8n’s UI. That is a trap.

The better wedge is this:

> n8n workflows are automations. Prisma Workflows are database-backed software artifacts.

That distinction gives you a serious developer/platform story:

* every workflow has a schema
* every event is persisted
* every run is queryable
* every step has typed inputs and outputs
* every state transition is auditable
* every execution can be replayed
* every workflow can be deployed like a TypeScript app
* every connector can be typed
* every agent-generated workflow can be reviewed as code

That is the “agent-native” foundation.

---

# 4. Prisma Workflows architecture

Think of Prisma Workflows as five components:

```txt
┌────────────────────────────────────────────────────────────┐
│                    Prisma Workflows                        │
├────────────────────────────────────────────────────────────┤
│ 1. Workflow schema / manifest                              │
│ 2. Generated workflow client + types                       │
│ 3. Postgres-backed runtime tables                          │
│ 4. Event ingest + sync framework                           │
│ 5. Studio / canvas / replay inspector                      │
└────────────────────────────────────────────────────────────┘
```

Then your n8n competitor sits above it:

```txt
┌────────────────────────────────────────────────────────────┐
│            Agent-Native n8n Competitor                     │
├────────────────────────────────────────────────────────────┤
│ Natural-language builder                                   │
│ n8n importer                                               │
│ Hosted canvas                                              │
│ Connector marketplace                                      │
│ Templates                                                  │
│ Enterprise admin                                           │
│ Workflow evals                                             │
│ Migration concierge                                        │
└────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│                    Prisma Workflows                        │
├────────────────────────────────────────────────────────────┤
│ Workflow schema / IR                                       │
│ Generated client                                           │
│ Runtime tables                                             │
│ Event ingest                                               │
│ Durable execution                                          │
│ Studio visualization                                       │
└────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│        Prisma ORM + Prisma Postgres + Prisma Compute       │
└────────────────────────────────────────────────────────────┘
```

---

# 5. Schema design

There are two possible routes.

## Option A: Extend `schema.prisma` directly

Example:

```prisma
generator client {
  provider = "prisma-client"
  output   = "./generated/prisma"
}

generator workflows {
  provider = "prisma-workflows"
  output   = "./generated/workflows"
  schema   = "_prisma_workflows"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["app", "_prisma_workflows"]
}

model Customer {
  id        String   @id
  email     String   @unique
  stripeId  String?  @unique
  createdAt DateTime @default(now())

  @@schema("app")
}

workflow StripeDisputeResponse {
  trigger stripeDisputeCreated {
    source   = stripe
    event    = "charge.dispute.created"
    dedupeBy = "event.id"
  }

  state DisputeCase {
    disputeId String @id
    customerId String?
    amount Int
    status String
    confidence Float?
  }

  step loadCustomer {
    run     = "./workflows/stripe-dispute/load-customer.ts"
    timeout = "30s"
    retry   = { maxAttempts = 3, backoff = "exponential" }
  }

  step draftEvidence {
    run        = "./workflows/stripe-dispute/draft-evidence.ts"
    timeout    = "2m"
    checkpoint = true
    budget     = { maxUsd = 0.25 }
  }

  approval approveEvidence {
    when    = "state.amount > 500 || state.confidence < 0.85"
    timeout = "24h"
  }

  step submitEvidence {
    run         = "./workflows/stripe-dispute/submit-evidence.ts"
    idempotency = "state.disputeId"
  }
}
```

This is the cleanest long-term product because it makes workflows feel like a native Prisma concept.

But it is also the heaviest change. The current Prisma schema has a defined role around datasource configuration, generators, and data models; Prisma Migrate then uses the schema to produce SQL migration history. Adding new top-level workflow semantics would be a real Prisma language/runtime expansion, not just a package. ([Prisma][4])

## Option B: Sidecar workflow manifest first

This is what I would do first.

Keep `schema.prisma` focused on data, then add a workflow manifest:

```prisma
// schema.prisma

generator client {
  provider = "prisma-client"
  output   = "./generated/prisma"
}

generator workflows {
  provider = "prisma-workflows"
  output   = "./generated/workflows"
  manifest = "./prisma/workflows.prisma"
  schema   = "_prisma_workflows"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["app", "_prisma_workflows"]
}
```

Then:

```prisma
// prisma/workflows.prisma

connector stripe {
  provider   = "@prisma-workflows/connector-stripe"
  credential = "stripe_prod"
}

workflow StripeDisputeResponse {
  trigger stripeDisputeCreated {
    connector = stripe
    event     = "charge.dispute.created"
    dedupeBy  = "event.id"
  }

  step loadCustomer {
    run = "./workflows/stripe-dispute/load-customer.ts"
  }

  step draftEvidence {
    run = "./workflows/stripe-dispute/draft-evidence.ts"
  }

  approval approveEvidence {
    when = "amount > 500"
  }

  step submitEvidence {
    run = "./workflows/stripe-dispute/submit-evidence.ts"
  }
}
```

This gives Prisma room to validate the design without burdening the core schema language too early.

My recommendation:

> **Start with a generator + sidecar manifest. Graduate to native `workflow` blocks once the semantics are proven.**

This matches Prisma’s existing generator model: generators can produce code from the schema, and the newer `prisma-client` generator outputs plain TypeScript into a configured directory, which fits a workflow codegen story well. ([Prisma][5])

---

# 6. Generated developer API

Prisma Workflows should generate an extension on top of Prisma Client.

Prisma Client extensions already support adding model, client, query, and result-level functionality, so this is the right fit for workflow operations like enqueueing, replaying, approving, inspecting, and querying runs. ([Prisma][6])

Example:

```ts
import { PrismaClient } from "./generated/prisma";
import { workflows } from "./generated/workflows";

const prisma = new PrismaClient().$extends(workflows());

await prisma.workflow.enqueue("StripeDisputeResponse", {
  disputeId: "dp_123",
});

const run = await prisma.workflow.run.findUnique({
  where: { id: "run_123" },
  include: {
    steps: true,
    timeline: true,
    stateSnapshots: true,
  },
});

await prisma.workflow.replay("run_123", {
  fromStep: "draftEvidence",
});

await prisma.workflow.approve("approval_123", {
  approvedBy: "user_456",
});
```

The generated API should expose:

```ts
prisma.workflow.enqueue(...)
prisma.workflow.run(...)
prisma.workflow.step(...)
prisma.workflow.replay(...)
prisma.workflow.cancel(...)
prisma.workflow.pause(...)
prisma.workflow.resume(...)
prisma.workflow.approve(...)
prisma.workflow.reject(...)
prisma.workflow.ingest(...)
prisma.workflow.deadLetter(...)
```

And generated types:

```ts
type StripeDisputeResponseInput
type StripeDisputeResponseState
type StripeDisputeResponseRun
type StripeDisputeResponseStepName
type StripeDisputeCreatedEvent
```

This makes workflows feel native to TypeScript developers.

---

# 7. Database model

The core insight: **the workflow engine should be event-sourced enough to replay history, but relational enough to query operational state.**

I would create a dedicated Postgres schema:

```txt
_prisma_workflows
```

Core tables:

| Table                      | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `WorkflowDefinition`       | Logical workflow identity                          |
| `WorkflowVersion`          | Immutable compiled workflow graph/version          |
| `WorkflowRun`              | One execution of one workflow version              |
| `WorkflowStepRun`          | One step attempt within a run                      |
| `WorkflowTimelineEvent`    | Append-only history of everything that happened    |
| `WorkflowStateSnapshot`    | State after each major transition                  |
| `WorkflowIngestEvent`      | Raw and normalized external events                 |
| `WorkflowTriggerMatch`     | Which workflows matched an ingest event            |
| `WorkflowLease`            | Worker lease/lock for running jobs                 |
| `WorkflowTimer`            | Sleeps, delays, scheduled resumes                  |
| `WorkflowApproval`         | Human approval checkpoints                         |
| `WorkflowOutbox`           | External side effects waiting to be committed      |
| `WorkflowDeadLetter`       | Failed events/runs requiring intervention          |
| `WorkflowConnectorAccount` | Connected external account metadata                |
| `WorkflowConnectorCursor`  | Polling/backfill cursors                           |
| `WorkflowCanvasLayout`     | Node positions and visual metadata                 |
| `WorkflowArtifact`         | Large payload references, blobs, logs, attachments |

Example Prisma models:

```prisma
model WorkflowDefinition {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  versions    WorkflowVersion[]
  runs        WorkflowRun[]

  @@schema("_prisma_workflows")
}

model WorkflowVersion {
  id             String   @id @default(cuid())
  workflowId     String
  version        Int
  status         String
  sourceHash     String
  compiledGraph  Json
  visualGraph    Json
  createdAt      DateTime @default(now())

  workflow       WorkflowDefinition @relation(fields: [workflowId], references: [id])
  runs           WorkflowRun[]

  @@unique([workflowId, version])
  @@schema("_prisma_workflows")
}

model WorkflowIngestEvent {
  id                  String   @id @default(cuid())
  source              String
  connectorAccountId  String?
  externalId          String
  eventType           String
  dedupeKey           String   @unique
  occurredAt          DateTime?
  receivedAt          DateTime @default(now())

  headers             Json?
  rawPayload          Json
  normalizedPayload   Json?
  signatureVerified   Boolean  @default(false)

  status              String   @default("received")
  error               String?

  runs                WorkflowRun[]

  @@index([source, eventType, receivedAt])
  @@index([status, receivedAt])
  @@schema("_prisma_workflows")
}

model WorkflowRun {
  id             String   @id @default(cuid())
  workflowId     String
  versionId      String
  ingestEventId  String?

  status         String
  currentStep    String?
  input          Json
  output         Json?
  state          Json?
  error          Json?

  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  workflow       WorkflowDefinition @relation(fields: [workflowId], references: [id])
  version        WorkflowVersion @relation(fields: [versionId], references: [id])
  ingestEvent    WorkflowIngestEvent? @relation(fields: [ingestEventId], references: [id])

  steps          WorkflowStepRun[]
  timeline       WorkflowTimelineEvent[]
  snapshots      WorkflowStateSnapshot[]

  @@index([workflowId, status, createdAt])
  @@index([status, createdAt])
  @@schema("_prisma_workflows")
}

model WorkflowStepRun {
  id            String   @id @default(cuid())
  runId         String
  nodeId        String
  stepName      String
  attempt       Int
  status        String

  input         Json?
  output        Json?
  error         Json?

  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime @default(now())

  run           WorkflowRun @relation(fields: [runId], references: [id])

  @@unique([runId, nodeId, attempt])
  @@index([runId, nodeId])
  @@schema("_prisma_workflows")
}

model WorkflowTimelineEvent {
  id          String   @id @default(cuid())
  runId       String
  sequence    Int
  type        String
  nodeId      String?
  payload     Json?
  createdAt   DateTime @default(now())

  run         WorkflowRun @relation(fields: [runId], references: [id])

  @@unique([runId, sequence])
  @@index([runId, sequence])
  @@schema("_prisma_workflows")
}

model WorkflowStateSnapshot {
  id          String   @id @default(cuid())
  runId       String
  sequence    Int
  nodeId      String?
  state       Json
  diff        Json?
  createdAt   DateTime @default(now())

  run         WorkflowRun @relation(fields: [runId], references: [id])

  @@unique([runId, sequence])
  @@schema("_prisma_workflows")
}
```

This is the core of the product.

The workflow canvas, debugger, replay mechanism, and audit trail all become different views over the same durable data.

---

# 8. Historic execution canvas

This is one of the strongest Prisma-native features.

n8n lets users view executions and debug or copy previous execution data into the editor. ([docs.n8n.io][3]) Prisma Workflows can go deeper because the workflow state is a first-class database artifact.

The canvas should have three modes:

## 1. Definition mode

Shows the workflow graph from `WorkflowVersion.compiledGraph`.

```txt
Stripe Event → Load Customer → Draft Evidence → Approval → Submit Evidence
```

This is the static workflow.

## 2. Live execution mode

Overlays current execution state from `WorkflowRun` and `WorkflowStepRun`.

```txt
Stripe Event ✅
Load Customer ✅
Draft Evidence ⏳
Approval pending
Submit Evidence not started
```

The UI should show:

* current node
* step status
* attempt count
* duration
* input
* output
* error
* retry schedule
* state diff
* logs
* external calls
* cost

## 3. Time-travel mode

Uses `WorkflowTimelineEvent` and `WorkflowStateSnapshot`.

The user gets a slider:

```txt
t0 ── t1 ── t2 ── t3 ── t4 ── t5
│     │     │     │     │     │
run   step  step  state approve done
start start done  diff  wait
```

When the user drags the slider, the canvas updates:

* highlight active node at that point in history
* show state at that point
* show state diff from previous point
* show inputs/outputs
* show pending timers/approvals
* show external side effects already committed
* show replay options from that point

This becomes a serious advantage over traditional workflow tools.

Important design rule:

> **A historical run must always render against the exact workflow version it executed.**

So every run must point to `WorkflowVersion`, and every version must preserve the compiled graph and visual graph forever, or at least until retention deletes it.

---

# 9. Event ingest and sync

Your ingest-table idea is exactly right.

Do not let external events trigger workflows directly.

External events should first become durable database records.

```txt
Stripe webhook
   ↓
verify signature
   ↓
WorkflowIngestEvent
   ↓
trigger matcher
   ↓
WorkflowRun
   ↓
executor
   ↓
WorkflowStepRun / Timeline / StateSnapshot
```

For Stripe specifically, the connector should preserve the raw request body and headers because Stripe webhook verification depends on the raw body, the `Stripe-Signature` header, and the endpoint secret. ([docs.stripe.com][7])

The ingest flow should be:

1. Receive webhook.
2. Capture raw body.
3. Verify provider signature.
4. Compute dedupe key.
5. Insert `WorkflowIngestEvent`.
6. Normalize event.
7. Match triggers.
8. Insert one or more `WorkflowRun` rows.
9. Acknowledge quickly.
10. Let workers execute asynchronously.

The dedupe key should be provider-aware:

```txt
stripe:{accountId}:{event.id}
github:{installationId}:{deliveryId}
slack:{teamId}:{event_id}
custom:{source}:{externalId}
```

The ingest table needs these properties:

```txt
source
connectorAccountId
externalId
eventType
dedupeKey
occurredAt
receivedAt
headers
rawPayload
normalizedPayload
signatureVerified
status
error
```

The event ingestion system should support two modes.

## Webhook mode

Used for Stripe, GitHub, Slack, Shopify, Linear, etc.

```txt
POST /api/prisma-workflows/ingest/stripe/:accountId
```

## Sync/backfill mode

Used when a system does not push all needed events, or when a user wants to backfill historical state.

```bash
npx prisma workflow sync stripe --from 2026-01-01
```

This writes into the same `WorkflowIngestEvent` table.

That is important. Whether an event came from a real-time webhook or a historical sync, the workflow engine should see the same durable event envelope.

---

# 10. Durable execution runtime

The runtime should use Postgres as the coordination layer.

Do not claim exactly-once execution. That is a losing promise. External APIs, retries, network failures, and crashes make true exactly-once side effects unrealistic.

Promise this instead:

> **At-least-once execution with idempotent side effects, durable state, dedupe keys, replay, and auditability.**

Execution flow:

```txt
WorkflowRun(status = queued)
   ↓
worker claims run with lease
   ↓
step starts
   ↓
append STEP_STARTED
   ↓
execute step
   ↓
persist output
   ↓
append STEP_COMPLETED
   ↓
persist state snapshot
   ↓
advance to next step
```

The worker should use leases:

```txt
WorkflowLease {
  resourceType: "run" | "step" | "timer"
  resourceId
  workerId
  lockedUntil
  heartbeatAt
}
```

A worker claims work by acquiring a lease. If the worker dies, another worker can reclaim the run after `lockedUntil`.

This gives you:

* crash recovery
* horizontal scaling
* retries
* scheduled resumes
* human approval waits
* backpressure
* replay

For long waits, do not keep a process alive. Persist a timer:

```txt
WorkflowTimer {
  runId
  nodeId
  resumeAt
  status
}
```

Then resume later.

This matters because many business workflows are not short-lived:

* wait 3 days for invoice payment
* wait until subscription renewal
* wait for human approval
* retry tomorrow
* follow up next week
* pause until CRM field changes

The runtime should be mostly database-driven, not process-memory-driven.

---

# 11. Compute deployment model

For your broader product vision — “every workflow is deployed to Prisma Compute” — I would use this model:

```txt
Each workflow app is a TypeScript package.
Each package contains:
  - workflow manifest
  - generated Prisma client
  - generated workflow client
  - step functions
  - connector bindings
  - HTTP ingest endpoints
  - worker entrypoint
  - Studio metadata
```

Deployed artifact:

```txt
/prisma
  schema.prisma
  workflows.prisma
/src
  workflows/
    stripe-dispute/
      load-customer.ts
      draft-evidence.ts
      submit-evidence.ts
  app.ts
  worker.ts
/generated
  prisma/
  workflows/
```

Commands:

```bash
npx prisma generate
npx prisma migrate deploy
npx prisma workflow compile
npx prisma app deploy
```

But because Compute’s public positioning still says background workers and cron are coming soon, I would avoid making background worker support a hard prerequisite. ([Prisma][2])

Initial deployment options:

| Runtime piece         | Initial implementation                                   |
| --------------------- | -------------------------------------------------------- |
| Webhook ingest        | Prisma Compute HTTP app                                  |
| API/control endpoints | Prisma Compute HTTP app                                  |
| Canvas data API       | Prisma Compute HTTP app                                  |
| Worker loop           | External runner or managed workflow runner               |
| Future worker loop    | Prisma Compute background worker when available          |
| Timers/cron           | Postgres-backed timers plus external scheduler initially |

Long-term:

```txt
Prisma Compute app
  ├── HTTP server
  ├── background worker
  ├── timer scheduler
  └── workflow executor
```

That becomes very elegant once Compute supports the needed workload shape directly.

---

# 12. Connector strategy

Yes, Prisma Workflows should have a mechanism to build connectors.

But it should not become a giant connector marketplace inside Prisma ORM core.

The split should be:

| Connector concern               | Prisma Workflows | Your product |
| ------------------------------- | ---------------- | ------------ |
| Connector SDK                   | Yes              | Uses it      |
| Typed event/action contracts    | Yes              | Uses it      |
| Ingest normalization            | Yes              | Uses it      |
| Dedupe/idempotency helpers      | Yes              | Uses it      |
| Local testing fixtures          | Yes              | Uses it      |
| Reference connectors            | A few            | Many         |
| Hosted OAuth app management     | Minimal          | Yes          |
| Connector marketplace           | No or very light | Yes          |
| Templates using connectors      | Examples only    | Yes          |
| Enterprise connector governance | Primitives only  | Yes          |

The SDK should define three connector types.

## 1. Event connectors

These ingest events.

Example:

```ts
import { defineConnector } from "@prisma/workflows/connector-sdk";

export default defineConnector({
  id: "stripe",
  displayName: "Stripe",

  auth: {
    type: "apiKey",
    secretRef: "STRIPE_SECRET_KEY",
  },

  events: {
    "charge.dispute.created": {
      verify: async ({ rawBody, headers, secrets }) => {
        // verify provider signature
      },

      dedupeKey: async ({ event, account }) => {
        return `stripe:${account.id}:${event.id}`;
      },

      normalize: async ({ event }) => {
        return {
          type: event.type,
          externalId: event.id,
          occurredAt: new Date(event.created * 1000),
          subject: event.data.object.id,
          payload: event,
        };
      },
    },
  },
});
```

## 2. Action connectors

These perform external actions inside steps.

Example:

```ts
export const stripe = defineConnector({
  id: "stripe",

  actions: {
    retrieveCustomer: action({
      input: z.object({
        customerId: z.string(),
      }),
      output: z.object({
        id: z.string(),
        email: z.string().nullable(),
      }),
      run: async ({ input, client }) => {
        return client.customers.retrieve(input.customerId);
      },
    }),

    submitDisputeEvidence: action({
      input: z.object({
        disputeId: z.string(),
        evidence: z.record(z.any()),
        idempotencyKey: z.string(),
      }),
      run: async ({ input, client }) => {
        return client.disputes.update(
          input.disputeId,
          { evidence: input.evidence },
          { idempotencyKey: input.idempotencyKey },
        );
      },
    }),
  },
});
```

## 3. Sync connectors

These backfill or periodically mirror external objects.

Example:

```ts
syncs: {
  subscriptions: incrementalSync({
    cursor: "updated",
    run: async ({ cursor, client }) => {
      return client.subscriptions.list({
        created: { gte: cursor },
      });
    },
  }),
}
```

This is important because real workflows often need both:

```txt
event: customer.subscription.updated
state: current subscription record
action: send invoice reminder
```

A connector that only handles actions is too weak. A connector that only handles events is also too weak. You need events, actions, and sync.

---

# 13. Connector SDK as a moat

The connector SDK should produce several artifacts:

```txt
Connector manifest
Typed event payloads
Typed action functions
OAuth/scopes metadata
Webhook endpoint metadata
Signature verification function
Dedupe strategy
Rate-limit hints
Idempotency hints
UI form metadata
Test fixtures
Mock provider
MCP tool descriptors
```

The MCP angle matters. Prisma already has an MCP server that lets AI tools manage Prisma Postgres databases through a standard transport. ([Prisma][8]) Prisma Workflows connectors could expose MCP-compatible tool descriptors so the natural-language builder can safely discover available events/actions.

That gives you this nice loop:

```txt
User: “When a Stripe dispute arrives, draft evidence and ask me before submitting.”

Agent queries connector capabilities:
  - stripe.charge.dispute.created
  - stripe.disputes.retrieve
  - stripe.disputes.update
  - zendesk.tickets.search
  - slack.messages.post

Agent generates workflow manifest + schema + step code.
```

This is where Prisma Workflows and your n8n competitor reinforce each other.

---

# 14. Canvas rendering model

The canvas should not be the source of truth.

The source of truth should be:

```txt
workflow manifest → compiled workflow graph → database-backed execution history
```

The canvas is a projection.

Store:

```txt
WorkflowVersion.compiledGraph
WorkflowVersion.visualGraph
WorkflowCanvasLayout
WorkflowRun
WorkflowStepRun
WorkflowTimelineEvent
WorkflowStateSnapshot
```

The graph structure should include:

```ts
type WorkflowGraph = {
  nodes: Array<{
    id: string;
    type: "trigger" | "step" | "approval" | "condition" | "parallel" | "timer";
    name: string;
    label: string;
    sourceRef?: string;
    codeRef?: string;
    config: Record<string, unknown>;
  }>;

  edges: Array<{
    from: string;
    to: string;
    condition?: string;
  }>;
};
```

The canvas overlay should be computed from execution data:

```ts
type ExecutionOverlay = {
  runId: string;
  sequence: number;
  nodes: Record<
    string,
    {
      status: "not_started" | "running" | "succeeded" | "failed" | "waiting" | "skipped";
      attempt?: number;
      startedAt?: string;
      completedAt?: string;
      durationMs?: number;
      error?: unknown;
      inputRef?: string;
      outputRef?: string;
      stateDiff?: unknown;
    }
  >;
};
```

This lets Prisma Studio render:

```txt
Workflow definition
Workflow run
Specific historical sequence
Current live state
Diff between two states
Replay branch
```

The canvas becomes an operational debugger, not just a diagramming tool.

---

# 15. Replay semantics

Replay needs careful product language.

There are three kinds of replay:

## 1. Pure replay

No external side effects. Use stored inputs/outputs to replay logic.

```txt
Safe for debugging.
```

## 2. Resume from failure

Continue a failed run from a specific step.

```txt
Safe if previous side effects are recorded and idempotency keys are used.
```

## 3. Re-execute from step

Actually rerun step code and external calls.

```txt
Dangerous unless side effects are mocked, idempotent, or explicitly approved.
```

The UI should label these clearly:

```txt
Replay with recorded outputs
Resume failed run
Re-execute from this step
Fork into new run
```

Every step should declare its side-effect mode:

```prisma
step submitEvidence {
  run         = "./submit-evidence.ts"
  sideEffects = "external"
  idempotency = "state.disputeId"
}
```

The runtime should refuse unsafe re-execution unless the user confirms or the workflow policy allows it.

---

# 16. Human approvals

Approvals should be first-class.

Database table:

```prisma
model WorkflowApproval {
  id          String   @id @default(cuid())
  runId       String
  nodeId      String
  status      String   @default("pending")
  requestedAt DateTime @default(now())
  resolvedAt  DateTime?
  resolvedBy  String?
  decision    Json?
  expiresAt   DateTime?

  @@index([status, requestedAt])
  @@schema("_prisma_workflows")
}
```

Workflow syntax:

```prisma
approval approveEvidence {
  when = "state.amount > 500 || state.confidence < 0.85"

  assignees = ["role:finance_ops"]
  timeout   = "24h"

  onApprove = submitEvidence
  onReject  = notifySupport
  onTimeout = escalate
}
```

This matters because agent-native workflows need explicit checkpoints. The product should make it easy to say:

```txt
The agent can draft.
The human must approve.
The workflow can submit.
```

---

# 17. Local developer experience

This is where Prisma can shine.

Prisma Postgres local development can already be started with `npx prisma dev`, backed by local Prisma Postgres/PGlite, and then used with Prisma ORM and migrations. ([Prisma][9]) Prisma Workflows should piggyback on that.

Ideal DX:

```bash
npx prisma workflow init
npx prisma dev
npx prisma migrate dev
npx prisma workflow dev
```

`prisma workflow dev` starts:

```txt
local ingest server
local worker
local timer loop
Studio workflow canvas
connector mocks
event fixture runner
```

Commands:

```bash
npx prisma workflow generate
npx prisma workflow dev
npx prisma workflow test
npx prisma workflow ingest stripe ./fixtures/dispute-created.json
npx prisma workflow replay run_123
npx prisma workflow backfill stripe --from 2026-01-01
npx prisma workflow inspect run_123
npx prisma workflow deploy
```

Fixture-based testing:

```bash
npx prisma workflow test StripeDisputeResponse
```

Example test:

```ts
import { testWorkflow } from "@prisma/workflows/testing";
import disputeCreated from "./fixtures/stripe-dispute-created.json";

test("requires approval for disputes over $500", async () => {
  const result = await testWorkflow("StripeDisputeResponse", {
    event: disputeCreated,
  });

  expect(result.currentNode).toBe("approveEvidence");
  expect(result.state.amount).toBeGreaterThan(500);
});
```

This would feel very Prisma: type-safe, local-first, generated, database-backed.

---

# 18. How this fits with your n8n competitor

Your product should treat Prisma Workflows as the compilation target.

The product flow:

```txt
User describes desired workflow
   ↓
Agent asks clarifying questions
   ↓
Agent designs workflow plan
   ↓
Agent generates:
   - Prisma models
   - workflow manifest
   - connector config
   - step functions
   - tests
   - seed events
   - evals
   ↓
Prisma generate
   ↓
Prisma migrate
   ↓
Deploy to Prisma Compute
   ↓
Run in shadow mode
   ↓
Promote to production
```

This is the central product differentiation.

n8n asks:

```txt
What nodes do you want to connect?
```

Your product asks:

```txt
What business process should exist?
```

Then it emits real software:

```txt
schema
workflow
database
runtime
tests
canvas
replay
deployment
```

That is much harder for n8n to neutralize with “AI workflow builder” messaging.

---

# 19. The ideal “Prisma Workflows” package map

I would sketch the packages like this:

```txt
@prisma/workflows
  Main runtime package

@prisma/workflows-client
  Generated client helpers

@prisma/workflows-generator
  Prisma generator

@prisma/workflows-runtime
  Durable executor

@prisma/workflows-studio
  Studio plugin / canvas renderer

@prisma/workflows-connector-sdk
  Connector SDK

@prisma/workflows-testing
  Fixture testing, replay testing, mocks

@prisma/workflows-mcp
  MCP tools for workflow generation/inspection

@prisma/workflows-connectors-stripe
  Reference Stripe connector

@prisma/workflows-connectors-http
  Generic HTTP connector

@prisma/workflows-connectors-webhook
  Generic webhook connector

@prisma/workflows-connectors-postgres
  DB event/model connector
```

Your n8n competitor then has:

```txt
agent-builder
hosted-control-plane
workflow-canvas
connector-marketplace
n8n-importer
template-gallery
enterprise-admin
billing
migration-service
```

---

# 20. What should live in Prisma Studio

Prisma Studio should get a “Workflows” tab.

Views:

## Workflow list

```txt
Name
Status
Latest version
Runs today
Failure rate
Avg duration
Last run
```

## Workflow canvas

Static definition plus live/historic overlays.

## Runs

```txt
Run ID
Version
Trigger
Status
Started
Duration
Current step
Error
```

## Run detail

```txt
Timeline
Canvas
State snapshots
Step inputs
Step outputs
Logs
Approvals
External calls
Replay controls
```

## Ingest events

```txt
Source
Event type
External ID
Received at
Matched workflows
Status
Raw payload
Normalized payload
```

## Dead letters

```txt
Failed events
Failed runs
Retry
Replay
Mark resolved
```

This is not a full no-code builder. It is a developer/operator view. Your n8n competitor can build the more polished business-user control plane on top.

---

# 21. Workflow IR

Prisma Workflows needs an internal representation that both schema-first and AI-generated workflows compile into.

Example:

```ts
type WorkflowIR = {
  id: string;
  name: string;
  version: number;

  triggers: TriggerIR[];

  nodes: WorkflowNodeIR[];

  edges: WorkflowEdgeIR[];

  stateSchema: JsonSchema;

  policies: {
    maxRetries?: number;
    timeout?: string;
    budget?: {
      maxUsdPerRun?: number;
      maxRunsPerDay?: number;
    };
    retention?: {
      runHistoryDays?: number;
      payloadDays?: number;
    };
  };

  connectors: ConnectorBindingIR[];
};
```

Node types:

```ts
type WorkflowNodeIR =
  | TriggerNode
  | StepNode
  | ConditionNode
  | ApprovalNode
  | TimerNode
  | ParallelNode
  | JoinNode
  | SubWorkflowNode;
```

This IR matters because your n8n importer can target the same thing.

```txt
n8n JSON → WorkflowIR → Prisma workflow manifest + code
Natural language → WorkflowIR → Prisma workflow manifest + code
Canvas editor → WorkflowIR → Prisma workflow manifest + code
```

That is a clean architecture.

---

# 22. Should Prisma Workflows include a canvas builder?

Lightly.

Prisma should include:

* graph rendering
* execution overlays
* step-through history
* replay controls
* error inspection
* state diffs
* ingest-event inspection

Prisma should not initially include:

* full drag-and-drop no-code builder
* connector marketplace UX
* business-user template customization
* enterprise workflow collaboration
* AI prompt-based workflow generation UI

Those should live in your product.

Why?

Because Prisma’s users are developers. A Studio canvas that explains and debugs workflows is very aligned. A full n8n-style authoring canvas risks pulling Prisma into a different product category.

So:

> **Prisma canvas = inspect/debug/replay.
> Your product canvas = create/collaborate/operate.**

---

# 23. Should Prisma Workflows include connectors?

Yes, but as a platform primitive.

The minimum connector layer should include:

```txt
defineConnector()
defineEvent()
defineAction()
defineSync()
defineAuth()
defineWebhookVerifier()
defineDedupeKey()
defineRateLimit()
defineIdempotency()
defineTestFixture()
```

Prisma should probably ship a few canonical connectors:

* HTTP
* Webhook
* Postgres
* Stripe
* GitHub
* Slack, maybe
* OpenAPI connector generator

But your product should own the big catalog and commercial connector experience.

The most important reason for Prisma to have a connector SDK is not connector volume. It is type safety.

A connector should make this possible:

```ts
export async function submitEvidence(ctx: WorkflowContext<"StripeDisputeResponse">) {
  const disputeId = ctx.state.disputeId;

  await ctx.connectors.stripe.submitDisputeEvidence({
    disputeId,
    evidence: ctx.state.evidence,
    idempotencyKey: ctx.run.id,
  });
}
```

That is much better than opaque JSON node configuration.

---

# 24. One concrete end-to-end example

User asks your product:

```txt
When a Stripe dispute is created, collect customer context,
draft evidence, ask me for approval if the amount is over $500,
then submit the evidence and post a Slack summary.
```

Your product generates:

```txt
schema.prisma
workflows.prisma
src/workflows/stripe-dispute/load-customer.ts
src/workflows/stripe-dispute/draft-evidence.ts
src/workflows/stripe-dispute/submit-evidence.ts
src/workflows/stripe-dispute/post-summary.ts
tests/stripe-dispute.test.ts
fixtures/stripe-dispute-created.json
```

Prisma Workflows compiles:

```txt
WorkflowDefinition
WorkflowVersion
Connector bindings
Generated workflow client
Postgres workflow tables
Canvas metadata
```

Deployment:

```bash
npx prisma migrate deploy
npx prisma workflow compile
npx prisma app deploy
```

Runtime:

```txt
Stripe sends webhook
   ↓
Prisma Workflows verifies signature
   ↓
WorkflowIngestEvent inserted
   ↓
StripeDisputeResponse run created
   ↓
loadCustomer executes
   ↓
draftEvidence executes
   ↓
approval waits
   ↓
human approves
   ↓
submitEvidence executes
   ↓
Slack summary posts
   ↓
run completes
```

Studio shows:

```txt
Stripe Event ✅
Load Customer ✅
Draft Evidence ✅
Approval ✅
Submit Evidence ✅
Post Summary ✅
```

The user can drag the timeline back to “Draft Evidence” and see:

```txt
input to LLM
retrieved Zendesk tickets
generated evidence
confidence score
state diff
approval reason
```

That is a very strong experience.

---

# 25. The risk to avoid

The biggest risk is overloading Prisma ORM with too much workflow semantics.

Bad version:

```txt
schema.prisma becomes a giant no-code automation DSL.
Prisma owns hundreds of SaaS connectors.
Prisma Studio becomes an n8n clone.
Runtime semantics become unclear.
Developers are confused whether Prisma is an ORM, iPaaS, or app platform.
```

Good version:

```txt
Prisma Workflows defines durable workflow infrastructure for TypeScript apps.
Workflow state, execution history, and event ingest are database-native.
Developers get generated types, migrations, local dev, and Studio inspection.
Higher-level automation products build on top.
```

The second version is much stronger.

---

# 26. My recommended MVP

For Prisma Workflows v0, I would build:

1. `generator workflows`
2. sidecar `workflows.prisma`
3. generated workflow client extension
4. `_prisma_workflows` Postgres schema
5. `WorkflowIngestEvent`
6. `WorkflowRun`
7. `WorkflowStepRun`
8. `WorkflowTimelineEvent`
9. `WorkflowStateSnapshot`
10. webhook ingest API
11. local worker
12. replay from failed step
13. Studio canvas inspector
14. Stripe reference connector
15. HTTP/webhook generic connectors
16. fixture-based workflow tests

Do not build full connector marketplace yet.

Do not build full AI builder inside Prisma yet.

Do not build full n8n canvas authoring yet.

Build the durable substrate.

---

# 27. The final strategic shape

The best version of this is:

```txt
Prisma ORM
  Defines data.

Prisma Workflows
  Defines durable business processes over that data.

Prisma Postgres
  Stores state, events, runs, history, approvals, and memory.

Prisma Compute
  Runs workflow apps and agentic TypeScript processes near the database.

Prisma Studio
  Inspects data, workflows, executions, and replay history.

Your n8n competitor
  Lets users describe workflows, imports n8n workflows, generates Prisma Workflows,
  deploys them, governs them, and sells the complete automation product.
```

That is a good split.

The connector answer is:

> **Yes, Prisma Workflows should have a connector-building mechanism. But Prisma should own the connector SDK and runtime contract, while your product owns the connector marketplace, hosted OAuth, templates, and customer-facing automation experience.**

That gives Prisma a valuable platform primitive without turning it into an n8n clone — and gives your product a much deeper architecture than n8n’s canvas-first model.

[1]: https://www.prisma.io/docs/orm "What is Prisma ORM? (Overview) | Prisma Documentation"
[2]: https://www.prisma.io/compute "Prisma Compute: Deploy TypeScript apps on Bun"
[3]: https://docs.n8n.io/workflows/executions/?utm_source=chatgpt.com "Executions"
[4]: https://www.prisma.io/docs/orm/prisma-schema/overview "Prisma schema | Prisma Documentation"
[5]: https://www.prisma.io/docs/orm/prisma-schema/overview/generators "Generators (Reference) | Prisma Documentation"
[6]: https://www.prisma.io/docs/orm/prisma-client/client-extensions "Prisma Client extensions | Prisma Documentation"
[7]: https://docs.stripe.com/webhooks?utm_source=chatgpt.com "Receive Stripe events in your webhook endpoint"
[8]: https://www.prisma.io/docs/ai/tools/mcp-server "Prisma MCP Server | Prisma Documentation"
[9]: https://www.prisma.io/docs/postgres/database/local-development "Local development with Prisma Postgres | Prisma Documentation"
