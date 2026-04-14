# Hackathon Plan: Prisma Next Durable Workflows on Compute

## Summary

Build a narrow, durable workflow slice for Prisma Next as `@prisma-next/extension-workflows`, deployed on Prisma Compute and backed by Prisma Postgres tables. The extension integrates through `prisma-next.config.ts` via `extensionPacks: [workflows]`, exposes workflow definitions with friendly retry/timeout syntax, and adds a `db.workflows` namespace to the Prisma Next client so app code can call `db.workflows.trigger(...)` directly. Success means a demoable approval workflow with automatic progression on Compute, per-step retry/backoff/timeout, state persisted relationally in Prisma Postgres, standard Prisma Next lint/budget middleware, and a small inspection console.

## Vercel-Inspired Boundaries

- Take inspiration from Vercel Workflow at the concept level only:
    - workflow = long-running coordinator
    - step = isolated retryable unit
    - signal = external event that resumes a waiting run
    - timeline/observability = every important transition is inspectable
- Do not copy Vercel’s implementation model:
    - no `'use workflow'` or `'use step'` directives
    - no compiler or bundler transforms
    - no generated per-step routes
    - no deterministic replay engine
    - no hidden persistence layer
- Keep the public authoring surface as ordinary TypeScript functions plus explicit helpers:
    - `defineWorkflow(...)`
    - `step(...)`
    - `awaitSignal(...)`

## PDP Cloudflare Inspirations

- Take the smallest useful patterns from Prisma’s Durable Workflows prototype:
    - `trigger` only enqueues work; execution happens later in the dispatcher
    - runs move through explicit statuses like `queued`, `running`, `waiting_for_signal`, `completed`, and `failed`
    - completed steps are memoized so recovery logic does not re-run them after crashes
    - expired leases are treated as stale work and reclaimed automatically
- Keep the same deliberate scope cuts:
    - no `pause`
    - no `resume`
    - no `terminate`
    - no `sleep`
    - no generic `waitForEvent` beyond `awaitSignal(signalId)`

## Key Changes

### Public API and integration

- Add `packages/3-extensions/workflows` with `control`, `runtime`, and `pack` exports, following the existing extension-pack convention.
- Prisma Next config shape:
    - `extensionPacks: [workflows]`
    - not `extensions: [workflows]`
- Authoring API:
    - `defineWorkflow(id, steps)`
    - `step(id, { handler, retries, timeout, backoff })`
    - `awaitSignal(signalId)`
    - `handler(ctx)` where `ctx` is `{ db, state, setState, runId, stepId, attempt, now }`
    - `trigger(workflowId, input)` seeds the initial workflow state from `input`
    - `signal(runId, signalId, payload)` merges `payload` into state before resuming the run
- App-facing Prisma Next client integration:
    - `db.workflows.trigger(workflowId, input)`
    - `db.workflows.signal(runId, signalId, payload?)`
    - `trigger(...)` returns `{ runId, status }` where `status` is the persisted workflow status immediately after enqueue
- Internal wiring:
    - keep an internal workflow runtime/service behind the extension
    - do not make that service the primary user-facing API
- Config ergonomics:
    - accept friendly strings like `'10s'`, `'60s'`, `'exponential'`
    - normalize internally to structured retry/timeout policies
- State shape:
    - workflow state is a flat typed record of scalar fields only
    - supported persisted field kinds are `string`, `number`, `boolean`, and `null`
    - handlers work with a normal TypeScript object, while persistence stores one relational row per state field in Prisma Postgres

### Durable execution model

- Use a queue-backed automatic runner for hackathon scope:
    - `trigger` writes the run in `queued` status, persists initial state rows, and inserts an initial ready job
    - a Compute-side dispatcher polls for due jobs, claims them with a lease, and runs them automatically
    - one dispatcher lease advances a run until it reaches `waiting_for_signal`, `queued` for retry, `completed`, or `failed`, bounded by a max steps/time budget per drain cycle
    - delayed retries enqueue the next job automatically at `next_retry_at`
    - external signals enqueue an immediate resume job automatically
    - expired leases are reclaimed and resumed automatically so crashed workers do not strand a run in `running`
- Prefer state-driven semantics over previous-step-output chaining:
    - each step reads durable `state`
    - completed step outputs are copied into named state fields when they must survive to later steps
    - no separate “prev” contract in v1
- Step lifecycle:
    - workflow-level `queued` → `running`
    - `running` → `waiting_for_signal`
    - `running` → `queued` for retry
    - `running` → `completed`
    - `running` → `failed`
- Step execution semantics:
    - step IDs must be unique within a workflow
    - once a step is marked completed for a run, dispatcher recovery skips re-executing it
    - retries only re-run the currently failing step, never prior completed steps

### Persistence schema

- `pn_workflow_runs`
    - `id`, `workflow_id`, `status`, `current_step_id`, `waiting_signal_id`, `version`, timestamps
- `pn_workflow_jobs`
    - `id`, `run_id`, `available_at`, `leased_until`, `status`, timestamps
- `pn_workflow_state_fields`
    - `run_id`, `field_name`, `field_kind`, `string_value`, `number_value`, `boolean_value`, `updated_at`
- `pn_workflow_step_runs`
    - `id`, `run_id`, `step_id`, `attempt`, `status`, `timeout_at`, `next_retry_at`, `error_message`, `started_at`, `finished_at`
    - completed rows are the memoized source of truth for “do not re-run this step”
- `pn_workflow_events`
    - append-only event log with relational columns for `event_type`, `run_id`, `step_id`, `attempt`, `signal_id`, `message`, `created_at`
- Use optimistic locking on `pn_workflow_runs` and leasing on `pn_workflow_jobs` to prevent duplicate execution.

### Middleware and runtime plumbing

- Reuse the normal Prisma Next SQL runtime for all workflow queries so existing lints/budgets apply unchanged.
- Tag workflow-originated plans with workflow metadata in plan annotations/meta:
    - `workflowId`
    - `runId`
    - `stepId`
    - `attempt`
- Do not add bespoke workflow middleware in v1; just propagate metadata through the existing plugin pipeline.

### Compute app and console

- Use `@prisma/compute-sdk` for programmatic Compute interactions from app/runtime code when Compute-specific API access is needed.
- Use `@prisma/management-api-sdk` to create the authenticated `ManagementApiClient` required by `@prisma/compute-sdk`.
- Programmatic Compute provisioning flow for the hackathon:
    - create a management API client from a service token
    - instantiate `const compute = new ComputeClient(apiClient)`
    - create a Compute service explicitly with `compute.createService({ projectId, serviceName, region })`
    - deploy code to that service with `compute.deploy({ serviceId, strategy: new PreBuilt({ appPath, entrypoint }) })`
    - persist `serviceId`, `serviceName`, `region`, `versionId`, and `deploymentUrl` into workflow state fields for the console
- Use the explicit `createService(...)` then `deploy(...)` flow in the demo instead of relying on implicit service resolution inside `deploy(...)`, because it makes “create a new Compute instance” visible and inspectable.
- Compute app endpoints:
    - `POST /workflow-runs/:runId/signals/:signalId`
    - `GET /workflow-runs`
    - `GET /workflow-runs/:runId`
    - `POST /internal/workflow-jobs/drain`
- Demo app/server code uses `db.workflows.trigger(...)` directly instead of a dedicated workflow trigger HTTP wrapper.
- Separate mini console app under `examples/workflows-console`:
    - run list
    - run detail
    - relational state view
    - step attempt timeline
    - approve/reject controls

## Actionable Tasks

### Milestone 1: Extension skeleton and workflow API

Owner: @Alberto Schiabel 

- Create `@prisma-next/extension-workflows` package with metadata, exports, tsconfig, build/test scripts, and README.
- Implement `pack`, `control`, and `runtime` descriptors so the extension can be registered through `extensionPacks`.
- Add authoring types and helpers for `defineWorkflow`, `step`, friendly retry/backoff/timeout normalization, and step handler context.
- Add Prisma Next client augmentation so loading the extension exposes `db.workflows.trigger(...)` and `db.workflows.signal(...)` with typed workflow IDs and inputs.
- Document the explicit non-goals in the README:
    - no bundler directives
    - no replay semantics
    - no pause/resume/terminate/sleep in v1
- Add unit tests for:
    - extension descriptor shape
    - timeout/backoff normalization
    - workflow definition typing
    - state-based step context typing
    - trigger-input-to-state typing
    - `db.workflows.trigger` and `db.workflows.signal` type exposure on the client

### Milestone 2: Durable runtime and persistence

Owner: @Matthias Oertel 

- Add persistence repositories for runs, jobs, state fields, step runs, and events.
- Implement the internal workflow runtime with `trigger` and `signal`.
- Bind the internal runtime into the Prisma Next client so `db.workflows.*` delegates to it.
- Implement state hydration/dehydration between flat TypeScript state objects and `pn_workflow_state_fields`.
- Implement the dispatcher queue:
    - claim due jobs with leases
    - load and lock the run
    - create the typed db client
    - execute ready steps in sequence until blocked or terminal
    - persist state field changes, step attempts, events, and next jobs
- Implement stale-lease recovery so a crashed dispatcher can safely resume queued work.
- Implement step memoization so completed steps are skipped on recovery.
- Implement per-step retry/backoff/timeout evaluation with automatic rescheduling.
- Add integration tests for:
    - `db.workflows.trigger(...)` creates a persisted run and returns `runId`
    - trigger input becomes initial state rows
    - successful multi-step progression without manual `tick`
    - completed steps are not re-executed after a dispatcher crash or lease expiry
    - retry scheduling and automatic resume after failure
    - timeout handling and lease recovery
    - `db.workflows.signal(...)` merges signal payload into state and resumes automatically
    - no re-execution of completed steps

### Milestone 3: Compute app and console

Owner: @Sampo Lahtinen 

- Build the Compute app that exposes the Prisma Next db client with `db.workflows.*`, plus public inspection/signal endpoints and the background dispatcher loop.
- Use `@prisma/compute-sdk` anywhere the hackathon implementation needs programmatic Compute management or service access, instead of trying to script the CLI from application code.
- Add a small Compute helper module that:
    - creates `ManagementApiClient` from `PRISMA_API_TOKEN`
    - creates `ComputeClient`
    - provisions a new service with `createService({ projectId, serviceName, region })`
    - deploys the service with `deploy({ serviceId, strategy: new PreBuilt(...) })`
- Create `examples/workflows-console` with a small React/Vite UI for run inspection and signal actions.
- Render:
    - workflow run status
    - current step
    - persisted state fields
    - event timeline
    - last error
    - next retry time
- Show Compute provisioning details on the run detail screen:
    - `serviceId`
    - `serviceName`
    - `region`
    - `versionId`
    - `deploymentUrl`
- Add a smoke test for the console and a manual deploy checklist for the Compute app and dispatcher.

### Milestone 4: Demo workflow and polish

- Implement `onboard-user` as the demo workflow, updated to Prisma Next semantics:
    - `create-account`
    - `await-approval`
    - `provision-compute-service`
- Model approval as durable state:
    - trigger starts the run
    - console `approve` or `reject` sends a signal payload to the run
    - the dispatcher resumes progression automatically after the signal arrives
- In `provision-compute-service`, use `@prisma/compute-sdk` to:
    - create a new Compute service with `createService(...)`
    - deploy a prebuilt app to that service with `deploy(...)`
    - persist the returned service/version/deployment identifiers into workflow state
- Add one controlled failure path in `provision-compute-service` to show automatic retry/backoff and inspection.
- Add a demo fixture or seed data plus a 3-minute walkthrough script.

## Example API Shape To Target

```tsx
// prisma-next.config.ts
import workflows from '@prisma-next/extension-workflows'

export default defineConfig({
  target: postgres,
  extensionPacks: [workflows],
  db: { connection: process.env['DATABASE_URL']! },
})
```

```tsx
// app code
const result = await db.workflows.trigger('onboard-user', {
  email: 'prismanaut@prisma.io',
  name: 'BloblobFoo',
  computeProjectId: 'proj_abc',
  computeRegion: 'us-east-1',
})

await db.workflows.signal(result.runId, 'approval', {
  approvalStatus: 'approved',
})
```

```tsx
// workflows/onboard-user.ts
import { awaitSignal, defineWorkflow, step } from '@prisma-next/extension-workflows'

export const onboardUser = defineWorkflow('onboard-user', [
  step('create-account', {
    timeout: '10s',
    retries: 3,
    async handler({ db, state, setState }) {
      const user = await db.users.create({
        email: state.email,
        name: state.name,
      })

      setState({
        ...state,
        userId: user.id,
        email: user.email,
        status: 'awaiting-approval',
      })
    },
  }),
  awaitSignal('approval'),
  step('provision-compute-service', {
    timeout: '60s',
    retries: 5,
    backoff: 'exponential',
    async handler({ db, state, setState }) {
      const provisioned = await provisionComputeService({
        projectId: state.computeProjectId,
        region: state.computeRegion,
        serviceName: `onboard-${state.userId}`,
      })

      setState({
        ...state,
        computeServiceId: provisioned.serviceId,
        computeVersionId: provisioned.versionId,
        computeDeploymentUrl: provisioned.deploymentUrl,
        status: 'provisioned',
      })
    },
  }),
])
```

```tsx
// compute/provision-compute-service.ts
import { ComputeClient, PreBuilt } from '@prisma/compute-sdk'
import { createManagementApiClient } from '@prisma/management-api-sdk'

export async function provisionComputeService(options: {
  projectId: string
  region: string
  serviceName: string
}) {
  const apiClient = createManagementApiClient({
    token: process.env['PRISMA_API_TOKEN']!,
  })

  const compute = new ComputeClient(apiClient)

  const service = await compute.createService({
    projectId: options.projectId,
    serviceName: options.serviceName,
    region: options.region,
  })
  if (service.isErr()) throw service.error

  const deployment = await compute.deploy({
    serviceId: service.value.id,
    strategy: new PreBuilt({
      appPath: './compute-app/dist',
      entrypoint: 'index.js',
    }),
  })
  if (deployment.isErr()) throw deployment.error

  return {
    serviceId: service.value.id,
    serviceName: service.value.name,
    region: service.value.region,
    versionId: deployment.value.versionId,
    deploymentUrl: deployment.value.deploymentUrl,
  }
}
```

## Test Plan

- Unit: API typing, policy normalization, step timeout math, retry schedule calculation.
- Unit: extension augments the Prisma Next client with a typed `workflows` namespace.
- Integration: persisted state survives in Prisma Postgres rows and drives later steps.
- Integration: state fields round-trip between flat TypeScript objects and relational storage.
- Integration: trigger input is persisted as initial state rows without a separate JSON payload store.
- Integration: each step receives the typed Prisma Next db client.
- Integration: the Compute provisioning helper creates a service with `createService(...)` and deploys to it with `deploy(...)`, and the returned identifiers are persisted into workflow state.
- Integration: workflow-generated queries still go through standard runtime plugins and preserve lint/budget behavior.
- Integration: approval pause/resume flow works without replaying prior successful steps.
- Integration: retries and ready steps progress automatically without manual `tick` or `retry`.
- Manual: Compute deployment handles trigger, signal, and background dispatch end to end.
- Manual: console reflects auto-progressing state transitions and errors live enough for the demo.

## Assumptions and defaults

- The old Prisma examples are adapted to Prisma Next’s existing `extensionPacks` model.
- v1 supports linear workflows only.
- v1 is inspired by Vercel Workflow concepts, but it does not implement directive-based authoring, generated routes, or replay-driven execution.
- v1 also borrows from Prisma’s Cloudflare Durable Workflows prototype: queue-first orchestration, explicit statuses, stale-work recovery, and step memoization.
- v1 stores workflow state as flat scalar fields in Prisma Postgres rows, not JSON blobs or nested documents.
- v1 uses the same flat scalar state model for both trigger input and signal payloads.
- v1 uses a Compute-side dispatcher loop polling `pn_workflow_jobs` for automatic progression.
- v1 includes `db.workflows.trigger(...)` and `db.workflows.signal(...)` as the primary app-facing integration; broader workflow query APIs remain out of scope.
- Use `@prisma/compute-sdk` for programmatic Compute access and keep `@prisma/compute-cli` for deployment.
- The demo creates a new Compute service explicitly with `ComputeClient.createService(...)` and then deploys to it with `ComputeClient.deploy(...)`.
- The inspection UI is a separate mini console, not part of the existing demo app.
- The deploy command remains `bunx @prisma/compute-cli@latest deploy` as provided by you.