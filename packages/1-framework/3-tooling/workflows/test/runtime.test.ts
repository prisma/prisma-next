import { describe, expect, it } from 'vitest';
import { compileWorkflowSchema } from '../src/compiler/compile';
import { defineConnector, defineEvent } from '../src/connector-sdk';
import {
  createMockDisputeConnectors,
  stripeDisputeCreatedFixture,
} from '../src/connectors/mock-providers';
import { createWorkflowHttpApp, createWorkflowRuntime } from '../src/runtime/engine';
import { InMemoryWorkflowStore, type WorkflowStore } from '../src/runtime/store';
import { testWorkflow } from '../src/testing/test-workflow';

const schema = `
workflow StripeDisputeResponse {
  trigger stripeDisputeCreated {
    source = stripe
    event = "charge.dispute.created"
    dedupeBy = "event.id"
  }

  state DisputeCase {
    disputeId String @id
    customerId String?
    amount Int
    confidence Float?
  }

  step loadCustomer {
    run = "./load-customer.ts"
  }

  step draftEvidence {
    run = "./draft-evidence.ts"
  }

  approval approveEvidence {
    when = "state.amount > 500 || state.confidence < 0.85"
    assignees = ["role:finance_ops"]
    onApprove = submitEvidence
  }

  step submitEvidence {
    run = "./submit-evidence.ts"
    sideEffects = "external"
    idempotency = "state.disputeId"
  }

  step postSlackSummary {
    run = "./post-slack-summary.ts"
  }
}
`;

describe('workflow runtime', () => {
  it('ingests matching events, waits for approval, resumes, and completes', async () => {
    const compiled = compileWorkflowSchema({ schema, sourceId: 'contract.prisma' });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: createMockDisputeConnectors(),
    });

    const ingest = await runtime.ingest({
      source: 'stripe',
      eventType: 'charge.dispute.created',
      payload: stripeDisputeCreatedFixture({ amount: 750 }),
    });

    expect(ingest.matchedWorkflows).toEqual(['StripeDisputeResponse']);
    expect(ingest.runs).toHaveLength(1);

    const [blocked] = await runtime.runUntilIdle();
    expect(blocked?.status).toBe('waiting_for_approval');

    const pendingApprovals = await runtime.pendingApprovals();
    expect(pendingApprovals).toHaveLength(1);
    const approval = pendingApprovals[0];
    expect(approval?.status).toBe('pending');

    const completed = await runtime.approve(approval!.id, {
      approvedBy: 'user_123',
      reason: 'Evidence is accurate',
    });

    expect(completed.status).toBe('completed');
    expect(completed.state).toMatchObject({
      submittedEvidenceId: 'evidence_dp_123',
      slackMessageId: 'slack_dp_123',
    });
    expect(await runtime.pendingApprovals()).toEqual([]);
  });

  it('does not run global reconciliation snapshots before ordinary queued claims', async () => {
    class SnapshotCountingStore extends InMemoryWorkflowStore {
      snapshotCalls = 0;
      timelineInspectionCalls = 0;
      stepInspectionCalls = 0;
      workflowVersionLookups = 0;
      snapshotsWithProvidedDiff = 0;

      override async findWorkflowVersion(
        versionId: Parameters<InMemoryWorkflowStore['findWorkflowVersion']>[0],
      ) {
        this.workflowVersionLookups += 1;
        return super.findWorkflowVersion(versionId);
      }

      override async inspectRun(input: Parameters<InMemoryWorkflowStore['inspectRun']>[0]) {
        if (input.include?.timeline === true) {
          this.timelineInspectionCalls += 1;
        }
        if (input.include?.steps === true) {
          this.stepInspectionCalls += 1;
        }
        return super.inspectRun(input);
      }

      override async snapshot() {
        this.snapshotCalls += 1;
        return super.snapshot();
      }

      override async appendSnapshotIfLeased(
        input: Parameters<InMemoryWorkflowStore['appendSnapshotIfLeased']>[0],
      ) {
        if (input.snapshot.diff !== undefined) {
          this.snapshotsWithProvidedDiff += 1;
        }
        return super.appendSnapshotIfLeased(input);
      }

      override async completeStepAndAdvanceIfLeased(
        input: Parameters<InMemoryWorkflowStore['completeStepAndAdvanceIfLeased']>[0],
      ) {
        if (input.snapshot.diff !== undefined) {
          this.snapshotsWithProvidedDiff += 1;
        }
        return super.completeStepAndAdvanceIfLeased(input);
      }

      override async createCompletedStepAndAdvanceIfLeased(
        input: Parameters<InMemoryWorkflowStore['createCompletedStepAndAdvanceIfLeased']>[0],
      ) {
        if (input.snapshot.diff !== undefined) {
          this.snapshotsWithProvidedDiff += 1;
        }
        return super.createCompletedStepAndAdvanceIfLeased(input);
      }
    }

    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow PlainDrain {
  step one {
    run = "./one.ts"
  }
}
`,
    });
    const store = new SnapshotCountingStore();
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        one: () => ({ ok: true }),
      },
    });

    const run = await runtime.enqueue('PlainDrain', {});
    await runtime.runUntilIdle();

    expect((await store.findRun(run.id))?.status).toBe('completed');
    expect(store.snapshotCalls).toBeLessThanOrEqual(3);
    expect(store.timelineInspectionCalls).toBe(0);
    expect(store.stepInspectionCalls).toBe(0);
    expect(store.workflowVersionLookups).toBeLessThanOrEqual(1);
    expect(store.snapshotsWithProvidedDiff).toBeGreaterThan(0);
  });

  it('deduplicates definition upserts for runtimes sharing one store and manifest', async () => {
    class UpsertCountingStore extends InMemoryWorkflowStore {
      upsertCalls = 0;

      override async upsertDefinitions(
        workflows: Parameters<InMemoryWorkflowStore['upsertDefinitions']>[0],
      ) {
        this.upsertCalls += 1;
        return super.upsertDefinitions(workflows);
      }
    }

    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow SharedDefinitions {
  step one {
    run = "./one.ts"
  }
}
`,
    });
    const store = new UpsertCountingStore();
    const first = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: { one: () => ({ first: true }) },
    });
    const second = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: { one: () => ({ second: true }) },
    });

    await first.enqueue('SharedDefinitions', {});
    await second.enqueue('SharedDefinitions', {});

    expect(store.upsertCalls).toBe(1);
  });

  it('matches manifest triggers during ingest without store trigger scans', async () => {
    class TriggerLookupCountingStore extends InMemoryWorkflowStore {
      triggerLookups = 0;

      override async findWorkflowByTrigger(
        source: Parameters<InMemoryWorkflowStore['findWorkflowByTrigger']>[0],
        eventType: Parameters<InMemoryWorkflowStore['findWorkflowByTrigger']>[1],
      ) {
        this.triggerLookups += 1;
        return super.findWorkflowByTrigger(source, eventType);
      }
    }

    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow IndexedIngest {
  trigger eventCreated {
    source = stripe
    event = "event.created"
  }

  step record {
    run = "./record.ts"
  }
}
`,
    });
    const store = new TriggerLookupCountingStore();
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        record: () => ({ recorded: true }),
      },
    });

    const result = await runtime.ingest({
      source: 'stripe',
      eventType: 'event.created',
      payload: { id: 'evt_indexed' },
    });

    expect(result.matchedWorkflows).toEqual(['IndexedIngest']);
    expect(result.runs).toHaveLength(1);
    expect(store.triggerLookups).toBe(0);
  });

  it('does not heartbeat leases for immediate step handlers', async () => {
    class LeaseHeartbeatCountingStore extends InMemoryWorkflowStore {
      heartbeatCalls = 0;

      override async extendLease(input: Parameters<InMemoryWorkflowStore['extendLease']>[0]) {
        this.heartbeatCalls += 1;
        return super.extendLease(input);
      }
    }

    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ImmediateHandler {
  step finish {
    run = "./finish.ts"
  }
}
`,
    });
    const store = new LeaseHeartbeatCountingStore();
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        finish: () => ({ done: true }),
      },
    });

    const run = await runtime.enqueue('ImmediateHandler', {});
    await runtime.runUntilIdle();

    expect((await store.findRun(run.id))?.status).toBe('completed');
    expect(store.heartbeatCalls).toBe(0);
  });

  it('scopes explicit ingest dedupe keys by connector account', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow AccountScopedIngest {
  trigger eventCreated {
    source = stripe
    event = "event.created"
  }

  step record {
    run = "./record.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        record: () => ({ recorded: true }),
      },
    });

    const first = await runtime.ingest({
      source: 'stripe',
      connectorAccountId: 'acct_1',
      eventType: 'event.created',
      dedupeKey: 'evt_same',
      payload: { id: 'evt_same' },
    });
    const second = await runtime.ingest({
      source: 'stripe',
      connectorAccountId: 'acct_2',
      eventType: 'event.created',
      dedupeKey: 'evt_same',
      payload: { id: 'evt_same' },
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(false);
    expect((await runtime.snapshot()).runs).toHaveLength(2);
  });

  it('rejects one ingest event when matched workflows disagree on dedupe keys', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow DedupeById {
  trigger eventCreated {
    source = test
    event = "event.created"
    dedupeBy = "event.id"
  }

  step recordA {
    run = "./record-a.ts"
  }
}

workflow DedupeByAlt {
  trigger eventCreated {
    source = test
    event = "event.created"
    dedupeBy = "event.alt"
  }

  step recordB {
    run = "./record-b.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        recordA: () => ({ a: true }),
        recordB: () => ({ b: true }),
      },
    });

    await expect(
      runtime.ingest({
        source: 'test',
        eventType: 'event.created',
        payload: { id: 'evt_1', alt: 'evt_2' },
      }),
    ).rejects.toThrow('incompatible dedupeBy expressions');
    await expect(
      runtime.ingest({
        source: 'test',
        eventType: 'event.created',
        payload: { id: 'same', alt: 'same' },
      }),
    ).rejects.toThrow('incompatible dedupeBy expressions');
  });

  it('testing helper returns blocked state for high-value disputes', async () => {
    const compiled = compileWorkflowSchema({ schema, sourceId: 'contract.prisma' });

    const result = await testWorkflow({
      manifest: compiled.manifest,
      workflowName: 'StripeDisputeResponse',
      event: stripeDisputeCreatedFixture({ amount: 900 }),
      steps: createMockDisputeConnectors(),
    });

    expect(result.run.status).toBe('waiting_for_approval');
    expect(result.currentNode).toBe('approval:approveEvidence');
  });

  it('persists trigger matches, approval metadata, and side-effect outbox records', async () => {
    const compiled = compileWorkflowSchema({ schema, sourceId: 'contract.prisma' });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: createMockDisputeConnectors(),
    });

    await runtime.ingest({
      source: 'stripe',
      eventType: 'charge.dispute.created',
      connectorAccountId: 'acct_stripe_001',
      headers: { 'stripe-signature': 'test' },
      payload: stripeDisputeCreatedFixture({ amount: 750 }),
    });
    await runtime.runUntilIdle();
    const pending = (await runtime.snapshot()).approvals[0];
    await runtime.approve(pending!.id, {
      approvedBy: 'finance@example.com',
      decision: { reviewed: true },
    });

    const snapshot = await runtime.snapshot();
    expect(snapshot.triggerMatches).toHaveLength(1);
    expect(snapshot.ingestEvents[0]).toMatchObject({
      connectorAccountId: 'acct_stripe_001',
      headers: { 'stripe-signature': 'test' },
    });
    expect(snapshot.approvals[0]).toMatchObject({
      assignees: ['role:finance_ops'],
      decision: { reviewed: true },
    });
    expect(snapshot.outbox[0]).toMatchObject({
      destination: './submit-evidence.ts',
      idempotencyKey: 'dp_123',
      status: 'dispatched',
    });
    expect(snapshot.outbox[0]?.dispatchedAt).toBeDefined();
  });

  it('stores timers and resumes due runs without holding a process open', async () => {
    const timerSchema = `
workflow FollowUp {
  trigger manual {
    source = test
    event = "follow.up"
  }

  timer waitOneSecond {
    delay = "1s"
  }

  step notify {
    run = "./notify.ts"
  }
}
`;
    const compiled = compileWorkflowSchema({ schema: timerSchema, sourceId: 'contract.prisma' });
    const store = new InMemoryWorkflowStore();
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        notify: () => ({ notified: true }),
      },
    });

    await runtime.ingest({
      source: 'test',
      eventType: 'follow.up',
      payload: { id: 'evt_timer' },
    });
    const [waiting] = await runtime.runUntilIdle();
    expect(waiting?.status).toBe('waiting_for_timer');

    const timer = (await runtime.snapshot()).timers[0];
    expect(timer?.status).toBe('scheduled');

    await runtime.resumeDueTimers(new Date(Date.now() + 2_000));
    const [completed] = await runtime.runUntilIdle();
    expect(completed?.status).toBe('completed');
    expect(completed?.state['notified']).toBe(true);
  });

  it('cancels stale timers when replay-resuming a waiting run', async () => {
    const timerSchema = `
workflow ReplayTimerWait {
  timer waitForLater {
    delay = "1h"
  }

  step notify {
    run = "./notify.ts"
  }
}
`;
    const compiled = compileWorkflowSchema({ schema: timerSchema, sourceId: 'contract.prisma' });
    const store = new InMemoryWorkflowStore();
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        notify: () => ({ notified: true }),
      },
    });

    const run = await runtime.enqueue('ReplayTimerWait', {});
    await runtime.runNext();
    const originalTimer = (await runtime.snapshot()).timers[0]!;

    await runtime.replay(run.id, { mode: 'resume', fromStep: 'waitForLater' });
    await runtime.runNext();

    const afterReplay = await runtime.snapshot();
    expect(afterReplay.timers.find((timer) => timer.id === originalTimer.id)?.status).toBe(
      'cancelled',
    );
    expect(afterReplay.timers.filter((timer) => timer.status === 'scheduled')).toHaveLength(1);

    await store.updateTimer(originalTimer.id, { status: 'completed' });
    await runtime.runNext();
    expect((await store.findRun(run.id))?.status).toBe('waiting_for_timer');

    await runtime.resumeDueTimers(new Date(Date.now() + 3_600_000));
    await runtime.runUntilIdle();
    expect((await runtime.snapshot()).runs[0]).toMatchObject({
      status: 'completed',
      state: { notified: true },
    });
  });

  it('labels replay modes and refuses unsafe external re-execution', async () => {
    const unsafeSchema = `
workflow UnsafeExternal {
  step chargeCard {
    run = "./charge-card.ts"
    sideEffects = "external"
  }
}
`;
    const compiled = compileWorkflowSchema({ schema: unsafeSchema, sourceId: 'contract.prisma' });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        chargeCard: () => ({ charged: true }),
      },
    });
    const original = await runtime.enqueue('UnsafeExternal', { amount: 10 });
    await runtime.runUntilIdle();

    await expect(
      runtime.replay(original.id, { fromStep: 'chargeCard', mode: 'reexecute' }),
    ).rejects.toThrow('Refusing to replay external side effects');

    const recorded = await runtime.replay(original.id, {
      fromStep: 'chargeCard',
      mode: 'recorded',
    });
    expect(recorded.status).toBe('completed');
    expect((await runtime.snapshot()).timeline.map((event) => event.type)).toContain(
      'RUN_REPLAYED_RECORDED',
    );
  });

  it('awaits async store registration before public operations', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReadyCheck {
  step record {
    run = "./record.ts"
  }
}
`,
    });
    const store = new DelayedUpsertStore();
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        record: () => ({ recorded: true }),
      },
    });

    const run = await runtime.enqueue('ReadyCheck', { id: 'evt_ready' });

    expect(run.workflowId).toBe('ready-check');
    expect(store.upsertCompleted).toBe(true);
  });

  it('keeps immutable workflow versions for replay after source changes', async () => {
    const store = new InMemoryWorkflowStore();
    const v1 = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow VersionedReview {
  step oldStep {
    run = "./old-step.ts"
  }
}
`,
    });
    const runtimeV1 = createWorkflowRuntime({
      manifest: v1.manifest,
      store,
      steps: {
        oldStep: () => ({ path: 'v1' }),
      },
    });
    const original = await runtimeV1.enqueue('VersionedReview', { id: 'evt_v1' });
    await runtimeV1.runUntilIdle();

    const v2 = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow VersionedReview {
  step newStep {
    run = "./new-step.ts"
  }
}
`,
    });
    const runtimeV2 = createWorkflowRuntime({
      manifest: v2.manifest,
      store,
      steps: {
        oldStep: () => ({ replayedPath: 'v1' }),
        newStep: () => ({ path: 'v2' }),
      },
    });
    const latest = await runtimeV2.enqueue('VersionedReview', { id: 'evt_v2' });
    await runtimeV2.runUntilIdle();
    const replayed = await runtimeV2.replay(original.id, { mode: 'fork' });
    await runtimeV2.runUntilIdle();

    const snapshot = await runtimeV2.snapshot();
    expect(new Set(snapshot.versions.map((version) => version.id)).size).toBe(2);
    expect(snapshot.definitions).toHaveLength(1);
    expect((await runtimeV2.inspect(latest.id))?.state).toMatchObject({ path: 'v2' });
    expect((await runtimeV2.inspect(replayed.id))?.state).toMatchObject({ replayedPath: 'v1' });
  });

  it('retries failed steps before dead-lettering', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow RetryReview {
  step flaky {
    run = "./flaky.ts"
    retry = { maxAttempts: 3, backoff: "fixed" }
  }
}
`,
    });
    let attempts = 0;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        flaky: () => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error(`temporary ${attempts}`);
          }
          return { attempts };
        },
      },
    });

    await runtime.enqueue('RetryReview', { id: 'evt_retry' });
    const results = await runtime.runUntilIdle();
    const completed = results[results.length - 1];

    const snapshot = await runtime.snapshot();
    expect(completed?.status).toBe('completed');
    expect(snapshot.steps.map((step) => step.attempt)).toEqual([1, 2, 3]);
    expect(snapshot.deadLetters).toHaveLength(0);
    expect(snapshot.timeline.map((event) => event.type)).toContain('STEP_RETRY_SCHEDULED');
  });

  it('deduplicates ingest per connector account', async () => {
    const compiled = compileWorkflowSchema({ schema, sourceId: 'contract.prisma' });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: createMockDisputeConnectors(),
    });
    const payload = stripeDisputeCreatedFixture({ amount: 100 });

    const first = await runtime.ingest({
      source: 'stripe',
      eventType: 'charge.dispute.created',
      connectorAccountId: 'acct_a',
      payload,
    });
    const duplicate = await runtime.ingest({
      source: 'stripe',
      eventType: 'charge.dispute.created',
      connectorAccountId: 'acct_a',
      payload,
    });
    const secondAccount = await runtime.ingest({
      source: 'stripe',
      eventType: 'charge.dispute.created',
      connectorAccountId: 'acct_b',
      payload,
    });

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(secondAccount.duplicate).toBe(false);
  });

  it('serves runtime-backed HTTP ingest and inspect routes', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow HttpReview {
  trigger eventCreated {
    source = "stripe"
    event = "event.created"
  }

  step record {
    run = "./record.ts"
  }
}
`,
    });
    const store = new InMemoryWorkflowStore();
    const app = createWorkflowHttpApp({
      manifest: compiled.manifest,
      store,
      steps: {
        record: () => ({ recorded: true }),
      },
    });
    const rawBody = JSON.stringify({ type: 'event.created', payload: { id: 'evt_http' } });

    const ingestResponse = await app.fetch(
      new Request('https://example.test/api/prisma-workflows/ingest/stripe/acct_1', {
        method: 'POST',
        body: rawBody,
      }),
    );
    const ingestBody = await ingestResponse.json();
    const runId = firstRunId(ingestBody);
    const queuedInspectResponse = await app.fetch(
      new Request(`https://example.test/api/prisma-workflows/inspect/${runId}`),
    );
    const queuedInspectBody = await queuedInspectResponse.json();
    const queuedRun = recordFromJson(recordFromJson(queuedInspectBody)['run']);
    expect(queuedRun['status']).toBe('queued');

    const workerResponse = await app.fetch(
      new Request('https://example.test/api/prisma-workflows/run', { method: 'POST' }),
    );
    expect(workerResponse.status).toBe(200);

    const inspectResponse = await app.fetch(
      new Request(`https://example.test/api/prisma-workflows/inspect/${runId}`),
    );
    const inspectBody = await inspectResponse.json();
    const run = recordFromJson(recordFromJson(inspectBody)['run']);
    const state = recordFromJson(run['state']);

    expect(ingestResponse.status).toBe(202);
    expect(run['status']).toBe('completed');
    expect(state['recorded']).toBe(true);
    expect(recordFromJson((await store.snapshot()).ingestEvents[0]?.rawPayload)).toMatchObject({
      rawBody,
      parsedBody: { type: 'event.created', payload: { id: 'evt_http' } },
    });
  });

  it('serves worker and replay routes backed by the same runtime', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow HttpWorker {
  step record {
    run = "./record.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        record: (context) => ({
          recorded: true,
          originalInput: recordFromJson(context.input)['id'],
        }),
      },
    });
    const app = createWorkflowHttpApp({
      manifest: compiled.manifest,
      runtime,
    });

    const original = await runtime.enqueue('HttpWorker', { id: 'evt_worker' });
    const runResponse = await app.fetch(
      new Request('https://example.test/api/prisma-workflows/run', { method: 'POST' }),
    );
    const runBody = recordFromJson(await runResponse.json());
    const processedRuns = runBody['processedRuns'];
    expect(Array.isArray(processedRuns)).toBe(true);
    expect(
      recordFromJson(Array.isArray(processedRuns) ? processedRuns[0] : undefined),
    ).toMatchObject({
      status: 'completed',
    });

    const replayResponse = await app.fetch(
      new Request(`https://example.test/api/prisma-workflows/replay/${original.id}`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'fork' }),
      }),
    );
    const replayBody = recordFromJson(await replayResponse.json());
    const replayedRuns = replayBody['processedRuns'];
    expect(replayResponse.status).toBe(200);
    expect(Array.isArray(replayedRuns)).toBe(true);
    expect(recordFromJson(Array.isArray(replayedRuns) ? replayedRuns[0] : undefined)).toMatchObject(
      {
        status: 'completed',
        state: { recorded: true, originalInput: 'evt_worker' },
      },
    );
  });

  it('heartbeats run leases while a long step is still executing', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow LongRunning {
  step slow {
    run = "./slow.ts"
  }
}
`,
    });
    const store = new InMemoryWorkflowStore();
    let releaseStep: (() => void) | undefined;
    let running: Promise<unknown> | undefined;
    const stepStarted = new Promise<void>((resolve) => {
      const runtimeA = createWorkflowRuntime({
        manifest: compiled.manifest,
        store,
        workerId: 'worker_a',
        leaseTtlMs: 60,
        steps: {
          slow: async () => {
            resolve();
            await new Promise<void>((release) => {
              releaseStep = release;
            });
            return { done: true };
          },
        },
      });
      running = runtimeA.enqueue('LongRunning', {}).then(() => runtimeA.runNext());
    });
    await stepStarted;
    await new Promise((resolve) => setTimeout(resolve, 130));

    const runtimeB = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      workerId: 'worker_b',
      leaseTtlMs: 60,
      steps: {
        slow: () => ({ stolen: true }),
      },
    });
    expect(await runtimeB.runNext()).toBeUndefined();
    releaseStep?.();
    await running;
    const completed = await store.findRun((await store.snapshot()).runs[0]!.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.state).toMatchObject({ done: true });
  });

  it('prevents stale workers from overwriting a run after lease ownership moves', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow StaleWorker {
  step slow {
    run = "./slow.ts"
  }
}
`,
    });
    const store = new InMemoryWorkflowStore();
    let releaseWorkerA: (() => void) | undefined;
    let workerARun: Promise<unknown> | undefined;
    const workerAStarted = new Promise<void>((resolve) => {
      const runtimeA = createWorkflowRuntime({
        manifest: compiled.manifest,
        store,
        workerId: 'worker_a',
        leaseTtlMs: 10,
        steps: {
          slow: async () => {
            resolve();
            await new Promise<void>((release) => {
              releaseWorkerA = release;
            });
            return { staleWrite: true };
          },
        },
      });
      workerARun = runtimeA.enqueue('StaleWorker', {}).then(() => runtimeA.runNext());
    });
    await workerAStarted;
    const runId = (await store.snapshot()).runs[0]!.id;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const runtimeB = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      workerId: 'worker_b',
      leaseTtlMs: 10,
      steps: {
        slow: () => ({ completedBy: 'worker_b' }),
      },
    });

    await runtimeB.runNext();
    releaseWorkerA?.();
    await workerARun;

    const final = await store.findRun(runId);
    expect(final?.status).toBe('completed');
    expect(final?.state).toMatchObject({ completedBy: 'worker_b' });
    expect(final?.state).not.toMatchObject({ staleWrite: true });
    expect((await store.snapshot()).deadLetters).toHaveLength(0);
  });

  it('replays from the historical state at the requested step', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayPoint {
  step first {
    run = "./first.ts"
  }

  step second {
    run = "./second.ts"
  }

  step third {
    run = "./third.ts"
  }
}
`,
    });
    const seenValues: unknown[] = [];
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        first: () => ({ value: 1 }),
        second: (context) => {
          seenValues.push(context.state['value']);
          return { value: 2 };
        },
        third: () => ({ value: 3 }),
      },
    });
    const original = await runtime.enqueue('ReplayPoint', {});
    await runtime.runUntilIdle();
    seenValues.length = 0;

    await runtime.replay(original.id, { mode: 'fork', fromStep: 'second' });
    await runtime.runUntilIdle();

    expect(seenValues).toEqual([1]);
  });

  it('restores a completed step instead of re-running it after a crash', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow CrashRestore {
  step first {
    run = "./first.ts"
  }

  step second {
    run = "./second.ts"
  }
}
`,
    });
    const store = new InMemoryWorkflowStore();
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        first: () => {
          throw new Error('first step must not run again');
        },
        second: () => ({ second: true }),
      },
    });
    const run = await runtime.enqueue('CrashRestore', { id: 'evt_restore' });
    await store.updateRun(run.id, {
      status: 'running',
      currentNode: 'step:first',
      startedAt: new Date(0),
    });
    await store.createStepRun({
      runId: run.id,
      nodeId: 'step:first',
      stepName: 'first',
      attempt: 1,
      status: 'completed',
      input: {},
      output: { first: true },
      startedAt: new Date(0),
      completedAt: new Date(1),
    });
    await store.acquireLease({
      resourceType: 'run',
      resourceId: run.id,
      workerId: 'dead_worker',
      ttlMs: 1,
      now: new Date(0),
    });

    const recovered = await runtime.runNext();
    const timeline = (await runtime.snapshot()).timeline.map((event) => event.type);

    expect(recovered?.status).toBe('completed');
    expect(recovered?.state).toMatchObject({ first: true, second: true });
    expect(timeline).toContain('STEP_RESTORED');
  });

  it('keeps one outbox intent for idempotent external side effects across replay', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow IdempotentExternal {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
  }
}
`,
    });
    let calls = 0;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        submit: () => {
          calls += 1;
          return { submitted: true };
        },
      },
    });
    const original = await runtime.enqueue('IdempotentExternal', { id: 'evt_outbox' });
    await runtime.runUntilIdle();
    await runtime.replay(original.id, { mode: 'fork' });
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(snapshot.outbox).toHaveLength(1);
    expect(snapshot.outbox[0]).toMatchObject({
      destination: './submit.ts',
      idempotencyKey: 'evt_outbox',
      status: 'dispatched',
    });
    expect(calls).toBe(1);
  });

  it('reuses earlier-epoch dispatched external output during replay resume', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ResumeExternalIdempotency {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
  }

  step flaky {
    run = "./flaky.ts"
  }
}
`,
    });
    let submitCalls = 0;
    let fail = true;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        submit: () => {
          submitCalls += 1;
          return { submitted: true, submitCalls };
        },
        flaky: () => {
          if (fail) throw new Error('after external failure');
          return { recovered: true };
        },
      },
    });
    const run = await runtime.enqueue('ResumeExternalIdempotency', { id: 'evt_resume_external' });
    await runtime.runUntilIdle();
    await runtime.dispatchNextOutbox();
    await runtime.runUntilIdle();
    expect((await runtime.snapshot()).runs[0]).toMatchObject({ status: 'failed' });

    fail = false;
    await runtime.replay(run.id, {
      mode: 'resume',
      fromStep: 'submit',
      confirmSideEffects: true,
    });
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(submitCalls).toBe(1);
    expect(snapshot.outbox).toHaveLength(1);
    expect(snapshot.runs[0]).toMatchObject({
      status: 'completed',
      state: { submitted: true, submitCalls: 1, recovered: true },
    });
  });

  it('resumes duplicate runs waiting on a pending idempotent outbox intent', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow PendingOutboxReplay {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
  }
}
`,
    });
    let calls = 0;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        submit: () => {
          calls += 1;
          return { submitted: true };
        },
      },
    });
    const original = await runtime.enqueue('PendingOutboxReplay', { id: 'evt_pending' });
    const pausedOriginal = await runtime.runNext();
    const fork = await runtime.replay(original.id, { mode: 'fork', fromStep: 'submit' });
    const pausedFork = await runtime.runNext();

    expect(pausedOriginal?.status).toBe('paused');
    expect(pausedFork?.status).toBe('paused');
    expect((await runtime.snapshot()).outbox).toHaveLength(1);

    await runtime.dispatchNextOutbox();
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    const runsById = new Map(snapshot.runs.map((run) => [run.id, run]));
    expect(calls).toBe(1);
    expect(runsById.get(original.id)?.status).toBe('completed');
    expect(runsById.get(fork.id)?.status).toBe('completed');
    expect(runsById.get(fork.id)?.state).toMatchObject({ submitted: true });
    expect(snapshot.steps.filter((step) => step.status === 'queued')).toHaveLength(0);
  });

  it('reconciles outbox waiters after a dispatched outbox lost wakeup', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow OutboxWaiterLostWakeup {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });
    const original = await runtime.enqueue('OutboxWaiterLostWakeup', { id: 'evt_waiter_recover' });
    await runtime.runNext();
    const fork = await runtime.replay(original.id, { mode: 'fork', fromStep: 'submit' });
    await runtime.runNext();
    const snapshot = await runtime.snapshot();
    const outbox = snapshot.outbox[0]!;
    const originalStep = snapshot.steps.find(
      (step) => step.runId === original.id && step.nodeId === outbox.nodeId,
    )!;
    const output = { submitted: true };

    await store.updateStepRun(originalStep.id, {
      status: 'completed',
      output,
      completedAt: new Date(),
    });
    await store.updateRun(original.id, {
      status: 'queued',
      currentNode: undefined,
      state: { id: 'evt_waiter_recover', ...output },
    });
    await store.updateOutbox(outbox.id, {
      status: 'dispatched',
      dispatchedAt: new Date(),
      error: null,
      payload: { ...recordFromJson(outbox.payload), output, stepRunId: originalStep.id },
    });

    await runtime.runUntilIdle();

    const recovered = await runtime.snapshot();
    const runsById = new Map(recovered.runs.map((run) => [run.id, run]));
    expect(runsById.get(original.id)).toMatchObject({ status: 'completed' });
    expect(runsById.get(fork.id)).toMatchObject({
      status: 'completed',
      state: { id: 'evt_waiter_recover', submitted: true },
    });
    expect(recovered.steps.filter((step) => step.status === 'queued')).toHaveLength(0);
  });

  it('reuses an existing unkeyed external outbox after a crash before pause', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow UnkeyedOutboxCrash {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });

    const run = await runtime.enqueue('UnkeyedOutboxCrash', {});
    await runtime.runNext();
    await store.updateRun(run.id, { status: 'running', currentNode: 'step:submit' });

    const recovered = await runtime.runNext();

    expect(recovered).toMatchObject({ status: 'paused', currentNode: 'step:submit' });
    expect((await runtime.snapshot()).outbox).toHaveLength(1);
  });

  it('dead-letters malformed outbox rows without stranding the owner run', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow MalformedOutboxRecovery {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });

    const run = await runtime.enqueue('MalformedOutboxRecovery', {});
    await store.createOutbox({
      runId: run.id,
      nodeId: 'step:submit',
      destination: './submit.ts',
      payload: { state: {}, input: {}, stepRunId: 'missing_step_run' },
      status: 'pending',
    });
    await runtime.runNext();

    await runtime.dispatchNextOutbox();
    await runtime.dispatchNextOutbox();
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(snapshot.runs[0]).toMatchObject({ status: 'completed', state: { submitted: true } });
    expect(snapshot.outbox.map((outbox) => outbox.status).sort()).toEqual(['dispatched', 'failed']);
    expect(snapshot.deadLetters).toHaveLength(1);
  });

  it('requeues runs parked only by a malformed outbox row', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow SoleMalformedOutboxRecovery {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });

    const run = await runtime.enqueue('SoleMalformedOutboxRecovery', {});
    await store.updateRun(run.id, { status: 'paused', currentNode: 'step:submit' });
    await store.createOutbox({
      runId: run.id,
      nodeId: 'step:submit',
      destination: './submit.ts',
      payload: { state: {}, input: {}, stepRunId: 'missing_step_run' },
      status: 'pending',
    });

    await runtime.dispatchNextOutbox();
    expect(await store.findRun(run.id)).toMatchObject({
      status: 'queued',
      currentNode: 'step:submit',
    });

    await runtime.runNext();
    await runtime.dispatchNextOutbox();
    await runtime.runUntilIdle();

    expect(await store.findRun(run.id)).toMatchObject({
      status: 'completed',
      state: { submitted: true },
    });
  });

  it('ignores stale outbox waiters from earlier replay epochs', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow StaleOutboxWaiterEpoch {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });

    const run = await runtime.enqueue('StaleOutboxWaiterEpoch', {});
    await runtime.runNext();
    const oldOutbox = (await runtime.snapshot()).outbox[0]!;
    await store.createStepRun({
      runId: run.id,
      nodeId: 'step:submit',
      stepName: 'submit',
      attempt: 2,
      status: 'queued',
      input: {},
      output: { outboxId: oldOutbox.id },
    });
    await store.updateRun(run.id, {
      status: 'failed',
      currentNode: 'step:submit',
      error: { message: 'failed before replay' },
      completedAt: new Date(),
    });

    await runtime.replay(run.id, { mode: 'resume', fromStep: 'submit', confirmSideEffects: true });
    await runtime.runNext();
    await runtime.dispatchNextOutbox();
    expect(await store.findRun(run.id)).toMatchObject({
      status: 'paused',
      currentNode: 'step:submit',
    });

    await runtime.dispatchNextOutbox();
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(snapshot.runs[0]).toMatchObject({ status: 'completed', state: { submitted: true } });
    const staleWaiter = snapshot.steps.find((step) => {
      if (!step.output || typeof step.output !== 'object' || Array.isArray(step.output)) {
        return false;
      }
      return Object.fromEntries(Object.entries(step.output))['outboxId'] === oldOutbox.id;
    });
    expect(staleWaiter?.status).toBe('queued');
  });

  it('fails external steps when the idempotency expression is missing', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow MissingIdempotency {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });

    await runtime.enqueue('MissingIdempotency', {});
    await runtime.enqueue('MissingIdempotency', {});
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(snapshot.runs.map((run) => run.status)).toEqual(['failed', 'failed']);
    expect(snapshot.outbox).toHaveLength(0);
    expect(snapshot.deadLetters).toHaveLength(2);
    expect(snapshot.deadLetters[0]?.reason).toContain('resolved to an empty value');
  });

  it('resolves approvals once and routes expired approvals through onTimeout', async () => {
    const timeoutSchema = `
workflow ApprovalTimeout {
  step prepare {
    run = "./prepare.ts"
  }

  approval review {
    when = "state.needsReview"
    timeout = "1ms"
    onTimeout = timeoutFallback
  }

  step timeoutFallback {
    run = "./timeout-fallback.ts"
  }
}
`;
    const compiled = compileWorkflowSchema({ schema: timeoutSchema, sourceId: 'contract.prisma' });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ needsReview: true }),
        timeoutFallback: () => ({ timedOut: true }),
      },
    });

    await runtime.enqueue('ApprovalTimeout', {});
    await runtime.runUntilIdle();
    const approval = (await runtime.snapshot()).approvals[0]!;

    await runtime.expireDueApprovals(new Date(Date.now() + 1_000));
    await runtime.runUntilIdle();

    const expiredSnapshot = await runtime.snapshot();
    expect(expiredSnapshot.approvals[0]).toMatchObject({ status: 'expired' });
    expect(expiredSnapshot.runs[0]).toMatchObject({
      status: 'completed',
      state: { needsReview: true, timedOut: true },
    });

    const lateApprove = await runtime.approve(approval.id, { approvedBy: 'late@example.com' });
    expect(lateApprove.status).toBe('completed');
    expect(
      (await runtime.snapshot()).timeline.filter((event) => event.type === 'APPROVAL_APPROVED'),
    ).toHaveLength(0);
  });

  it('continues through onApprove when an approval is not required', async () => {
    const skippedSchema = `
workflow SkippedApprovalDefault {
  step prepare {
    run = "./prepare.ts"
  }

  approval review {
    when = "state.needsReview"
    onApprove = submitEvidence
  }

  step submitEvidence {
    run = "./submit.ts"
  }

  step postSummary {
    run = "./post-summary.ts"
  }
}
`;
    const compiled = compileWorkflowSchema({ schema: skippedSchema, sourceId: 'contract.prisma' });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ needsReview: false }),
        submitEvidence: () => ({ submitted: true }),
        postSummary: () => ({ posted: true }),
      },
    });

    const run = await runtime.enqueue('SkippedApprovalDefault', {});
    await runtime.runUntilIdle();

    const completed = (await runtime.snapshot()).runs.find((candidate) => candidate.id === run.id);
    expect(completed).toMatchObject({
      status: 'completed',
      state: { needsReview: false, submitted: true, posted: true },
    });
  });

  it('fails closed for two-target skipped approval branches with an unbounded tail', async () => {
    const skippedSchema = `
workflow SkippedApprovalBranches {
  step prepare {
    run = "./prepare.ts"
  }

  approval review {
    when = "state.needsReview"
    onReject = rejectedPath
    onTimeout = timeoutPath
  }

  step rejectedPath {
    run = "./rejected.ts"
    sideEffects = "external"
  }

  step timeoutPath {
    run = "./timeout.ts"
    sideEffects = "external"
  }

  step summarize {
    run = "./summarize.ts"
  }
}
`;
    const compiled = compileWorkflowSchema({ schema: skippedSchema, sourceId: 'contract.prisma' });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ needsReview: false }),
        rejectedPath: () => ({ rejected: true }),
        timeoutPath: () => ({ timedOut: true }),
        summarize: () => ({ summarized: true }),
      },
    });

    await runtime.enqueue('SkippedApprovalBranches', {});
    await runtime.runUntilIdle();

    expect((await runtime.snapshot()).runs[0]).toMatchObject({
      status: 'failed',
      error: { message: expect.stringContaining('ambiguous branch layout') },
    });
  });

  it('jumps to a non-immediate onApprove target when approval is skipped', async () => {
    const skippedSchema = `
workflow SkippedApprovalJump {
  step prepare {
    run = "./prepare.ts"
  }

  approval review {
    when = "state.needsReview"
    onApprove = submitEvidence
  }

  step skippedFiller {
    run = "./skipped-filler.ts"
  }

  step submitEvidence {
    run = "./submit.ts"
  }

  step summarize {
    run = "./summarize.ts"
  }
}
`;
    const compiled = compileWorkflowSchema({ schema: skippedSchema, sourceId: 'contract.prisma' });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ needsReview: false }),
        skippedFiller: () => ({ skippedFiller: true }),
        submitEvidence: () => ({ submitted: true }),
        summarize: () => ({ summarized: true }),
      },
    });

    await runtime.enqueue('SkippedApprovalJump', {});
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(snapshot.runs[0]).toMatchObject({
      status: 'completed',
      state: { needsReview: false, submitted: true, summarized: true },
    });
    expect(snapshot.runs[0]?.state).not.toMatchObject({ skippedFiller: true });
    expect(snapshot.steps.map((step) => step.stepName)).toEqual([
      'prepare',
      'submitEvidence',
      'summarize',
    ]);
  });

  it('fails closed for ambiguous single-target approval branch skips', async () => {
    const ambiguousSchema = `
workflow AmbiguousApprovalBranch {
  step prepare {
    run = "./prepare.ts"
  }

  approval review {
    when = "state.needsReview"
    onReject = rejectedPath
  }

  step rejectedPath {
    run = "./rejected.ts"
  }

  step rejectedAudit {
    run = "./rejected-audit.ts"
  }

  step summarize {
    run = "./summarize.ts"
  }
}
`;
    const compiled = compileWorkflowSchema({
      schema: ambiguousSchema,
      sourceId: 'contract.prisma',
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ needsReview: false }),
        rejectedPath: () => ({ rejected: true }),
        rejectedAudit: () => ({ rejectedAudit: true }),
        summarize: () => ({ summarized: true }),
      },
    });

    await runtime.enqueue('AmbiguousApprovalBranch', {});
    await runtime.runUntilIdle();

    expect((await runtime.snapshot()).runs[0]).toMatchObject({
      status: 'failed',
      error: { message: expect.stringContaining('ambiguous branch layout') },
    });
  });

  it('skips unchosen approval outcome branches', async () => {
    const branchSchema = `
workflow BranchApproval {
  step prepare {
    run = "./prepare.ts"
  }

  approval review {
    when = "state.needsReview"
    assignees = ["role:ops"]
    timeout = "1h"
    onApprove = approvedPath
    onReject = rejectedPath
    onTimeout = timeoutPath
  }

  step approvedPath {
    run = "./approved.ts"
  }

  step approvedAudit {
    run = "./approved-audit.ts"
  }

  step rejectedPath {
    run = "./rejected.ts"
  }

  step rejectedAudit {
    run = "./rejected-audit.ts"
  }

  step timeoutPath {
    run = "./timeout.ts"
  }

  step timeoutAudit {
    run = "./timeout-audit.ts"
  }

  step summarize {
    run = "./summarize.ts"
  }
}
`;
    const compiled = compileWorkflowSchema({ schema: branchSchema, sourceId: 'contract.prisma' });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ needsReview: true }),
        approvedPath: () => ({ approvedPath: true }),
        approvedAudit: () => ({ approvedAudit: true }),
        rejectedPath: () => ({ rejectedPath: true }),
        rejectedAudit: () => ({ rejectedAudit: true }),
        timeoutPath: () => ({ timeoutPath: true }),
        timeoutAudit: () => ({ timeoutAudit: true }),
        summarize: () => ({ summarized: true }),
      },
    });

    await runtime.enqueue('BranchApproval', {});
    await runtime.runUntilIdle();
    const approval = (await runtime.snapshot()).approvals[0]!;

    const completed = await runtime.approve(approval.id, { approvedBy: 'ops@example.com' });

    expect(completed).toMatchObject({
      status: 'completed',
      state: {
        approvedPath: true,
        approvedAudit: true,
        summarized: true,
      },
    });
    expect(completed.state).not.toMatchObject({
      rejectedPath: true,
      rejectedAudit: true,
      timeoutPath: true,
      timeoutAudit: true,
    });
    expect((await runtime.snapshot()).steps.map((step) => step.stepName)).toEqual([
      'prepare',
      'approvedPath',
      'approvedAudit',
      'summarize',
    ]);
  });

  it('keeps approval outcome branches skipped when replay starts inside a branch', async () => {
    const branchSchema = `
workflow ReplayBranchApproval {
  step prepare {
    run = "./prepare.ts"
  }

  approval review {
    when = "state.needsReview"
    assignees = ["role:ops"]
    timeout = "1h"
    onApprove = approvedPath
    onReject = rejectedPath
    onTimeout = timeoutPath
  }

  step approvedPath {
    run = "./approved.ts"
  }

  step approvedAudit {
    run = "./approved-audit.ts"
  }

  step rejectedPath {
    run = "./rejected.ts"
    sideEffects = "external"
  }

  step rejectedAudit {
    run = "./rejected-audit.ts"
  }

  step timeoutPath {
    run = "./timeout.ts"
    sideEffects = "external"
  }

  step timeoutAudit {
    run = "./timeout-audit.ts"
  }

  step summarize {
    run = "./summarize.ts"
  }

  step flaky {
    run = "./flaky.ts"
  }
}
`;
    const compiled = compileWorkflowSchema({ schema: branchSchema, sourceId: 'contract.prisma' });
    const calls: string[] = [];
    let fail = true;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ needsReview: true }),
        approvedPath: () => {
          calls.push('approvedPath');
          return { approvedPath: true };
        },
        approvedAudit: () => {
          calls.push('approvedAudit');
          return { approvedAudit: true };
        },
        rejectedPath: () => {
          calls.push('rejectedPath');
          return { rejectedPath: true };
        },
        rejectedAudit: () => {
          calls.push('rejectedAudit');
          return { rejectedAudit: true };
        },
        timeoutPath: () => {
          calls.push('timeoutPath');
          return { timeoutPath: true };
        },
        timeoutAudit: () => {
          calls.push('timeoutAudit');
          return { timeoutAudit: true };
        },
        summarize: () => {
          calls.push('summarize');
          return { summarized: true };
        },
        flaky: () => {
          if (fail) throw new Error('fail after branch');
          return { done: true };
        },
      },
    });

    const run = await runtime.enqueue('ReplayBranchApproval', {});
    await runtime.runUntilIdle();
    const approval = (await runtime.snapshot()).approvals[0]!;
    await runtime.approve(approval.id, { approvedBy: 'ops@example.com' });
    expect(
      (await runtime.snapshot()).runs.find((candidate) => candidate.id === run.id),
    ).toMatchObject({
      status: 'failed',
    });

    fail = false;
    const fork = await runtime.replay(run.id, { mode: 'fork', fromStep: 'approvedAudit' });
    await runtime.runUntilIdle();
    await runtime.replay(run.id, { mode: 'resume', fromStep: 'approvedAudit' });
    await runtime.runUntilIdle();

    const runsById = new Map(
      (await runtime.snapshot()).runs.map((candidate) => [candidate.id, candidate]),
    );
    expect(runsById.get(fork.id)).toMatchObject({
      status: 'completed',
      state: { approvedAudit: true, summarized: true, done: true },
    });
    expect(runsById.get(run.id)).toMatchObject({
      status: 'completed',
      state: { approvedAudit: true, summarized: true, done: true },
    });
    expect(calls).not.toContain('rejectedPath');
    expect(calls).not.toContain('rejectedAudit');
    expect(calls).not.toContain('timeoutPath');
    expect(calls).not.toContain('timeoutAudit');
  });

  it('rejects unsafe replay inputs instead of silently rewriting history', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplaySafety {
  step first {
    run = "./first.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        first: () => ({ first: true }),
      },
    });
    const run = await runtime.enqueue('ReplaySafety', {});
    await runtime.runUntilIdle();

    await expect(runtime.replay(run.id, { mode: 'fork', fromStep: 'typo' })).rejects.toThrow(
      'Workflow replay step not found: typo',
    );
    await expect(runtime.replay(run.id, { mode: 'resume' })).rejects.toThrow(
      'Refusing to resume completed workflow run',
    );
    await expect(runtime.resume(run.id)).rejects.toThrow(
      'Refusing to resume completed workflow run',
    );
  });

  it('requires confirmation when replay can reach unsafe external side effects', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayFutureExternal {
  step prepare {
    run = "./prepare.ts"
  }

  step submit {
    run = "./submit.ts"
    sideEffects = "external"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ prepared: true }),
        submit: () => ({ submitted: true }),
      },
    });
    const run = await runtime.enqueue('ReplayFutureExternal', {});
    await runtime.runNext();

    await expect(runtime.replay(run.id, { mode: 'fork', fromStep: 'prepare' })).rejects.toThrow(
      'Refusing to replay external side effects for submit',
    );

    const replayed = await runtime.replay(run.id, {
      mode: 'fork',
      fromStep: 'prepare',
      confirmSideEffects: true,
    });
    expect(replayed).toMatchObject({ status: 'queued', currentNode: 'step:prepare' });
  });

  it('resumes failed runs through replay resume', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayResumeFailure {
  step flaky {
    run = "./flaky.ts"
  }

  step done {
    run = "./done.ts"
  }
}
`,
    });
    let fail = true;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        flaky: () => {
          if (fail) throw new Error('temporary failure');
          return { recovered: true };
        },
        done: () => ({ done: true }),
      },
    });
    const run = await runtime.enqueue('ReplayResumeFailure', {});
    await runtime.runUntilIdle();
    expect((await runtime.snapshot()).runs[0]).toMatchObject({ status: 'failed' });

    fail = false;
    const resumed = await runtime.replay(run.id, { mode: 'resume', fromStep: 'flaky' });
    expect(resumed).toMatchObject({ status: 'queued', currentNode: 'step:flaky' });
    await runtime.runUntilIdle();

    expect((await runtime.snapshot()).runs[0]).toMatchObject({
      status: 'completed',
      state: { recovered: true, done: true },
    });
  });

  it('does not restore pre-replay completed steps when replay-resuming', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayResumeEpoch {
  step prepare {
    run = "./prepare.ts"
  }

  step flaky {
    run = "./flaky.ts"
  }
}
`,
    });
    let value = 'old';
    let fail = true;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ value }),
        flaky: () => {
          if (fail) throw new Error('first attempt failed');
          return { done: true };
        },
      },
    });
    const run = await runtime.enqueue('ReplayResumeEpoch', {});
    await runtime.runUntilIdle();
    expect((await runtime.snapshot()).runs[0]).toMatchObject({
      status: 'failed',
      state: { value: 'old' },
    });

    value = 'new';
    fail = false;
    await runtime.replay(run.id, { mode: 'resume', fromStep: 'prepare' });
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(snapshot.runs[0]).toMatchObject({
      status: 'completed',
      state: { value: 'new', done: true },
    });
    expect(snapshot.steps.filter((step) => step.stepName === 'prepare')).toHaveLength(2);
    expect(snapshot.timeline.map((event) => event.type)).not.toContain('STEP_RESTORED');
  });

  it('uses the current replay epoch when replay-resuming repeatedly', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow RepeatedReplayResumeEpoch {
  step prepare {
    run = "./prepare.ts"
  }

  step flaky {
    run = "./flaky.ts"
  }
}
`,
    });
    let value = 'old';
    let failures = 0;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ value }),
        flaky: (context) => {
          failures += 1;
          if (failures < 3) throw new Error(`failure ${failures}`);
          return { seenValue: context.state['value'] };
        },
      },
    });
    const run = await runtime.enqueue('RepeatedReplayResumeEpoch', {});
    await runtime.runUntilIdle();

    value = 'new';
    await runtime.replay(run.id, { mode: 'resume', fromStep: 'prepare' });
    await runtime.runUntilIdle();
    await runtime.replay(run.id, { mode: 'resume', fromStep: 'flaky' });
    await runtime.runUntilIdle();

    expect((await runtime.snapshot()).runs[0]).toMatchObject({
      status: 'completed',
      state: { value: 'new', seenValue: 'new' },
    });
  });

  it('fails replay resume when an earlier non-first node has no current-epoch seed', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayMissingSeed {
  step prepare {
    run = "./prepare.ts"
  }

  step middle {
    run = "./middle.ts"
  }

  step flaky {
    run = "./flaky.ts"
  }
}
`,
    });
    let failures = 0;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ prepared: true }),
        middle: () => ({ middle: true }),
        flaky: () => {
          failures += 1;
          throw new Error(`failure ${failures}`);
        },
      },
    });
    const run = await runtime.enqueue('ReplayMissingSeed', {});
    await runtime.runUntilIdle();
    await runtime.replay(run.id, { mode: 'resume', fromStep: 'flaky' });
    await runtime.runUntilIdle();

    await expect(runtime.replay(run.id, { mode: 'resume', fromStep: 'middle' })).rejects.toThrow(
      'Workflow replay state not found for node step:middle',
    );
  });

  it('preserves replay epoch metadata when step output contains reserved keys', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayReservedState {
  step prepare {
    run = "./prepare.ts"
  }

  step reusable {
    run = "./reusable.ts"
  }

  step flaky {
    run = "./flaky.ts"
  }
}
`,
    });
    let value = 'old';
    let fail = true;
    let reusableCalls = 0;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: (context) => {
          context.state['$prismaWorkflow'] = { replayEpoch: 'mutated-state' };
          context.run.state['$prismaWorkflow'] = { replayEpoch: 'mutated-run' };
          return { value, $prismaWorkflow: {} };
        },
        reusable: (context) => {
          reusableCalls += 1;
          return { reused: context.state['value'] };
        },
        flaky: () => {
          if (fail) throw new Error('first attempt failed');
          return { done: true };
        },
      },
    });
    const run = await runtime.enqueue('ReplayReservedState', {});
    await runtime.runUntilIdle();

    value = 'new';
    fail = false;
    await runtime.replay(run.id, { mode: 'resume', fromStep: 'prepare' });
    await runtime.runUntilIdle();

    expect(reusableCalls).toBe(2);
    expect((await runtime.snapshot()).runs[0]).toMatchObject({
      status: 'completed',
      state: { value: 'new', reused: 'new', done: true },
    });
  });

  it('resets retry budgets for the current replay epoch', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayRetryBudget {
  step flaky {
    run = "./flaky.ts"
    retry = { maxAttempts = 2, backoff = "fixed" }
  }
}
`,
    });
    let calls = 0;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        flaky: () => {
          calls += 1;
          if (calls < 4) throw new Error(`temporary ${calls}`);
          return { calls };
        },
      },
    });
    const run = await runtime.enqueue('ReplayRetryBudget', {});
    await runtime.runUntilIdle();
    expect((await runtime.snapshot()).runs[0]).toMatchObject({ status: 'failed' });

    await runtime.replay(run.id, { mode: 'resume', fromStep: 'flaky' });
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(snapshot.runs[0]).toMatchObject({ status: 'completed', state: { calls: 4 } });
    expect(snapshot.steps.map((step) => [step.attempt, step.status])).toEqual([
      [1, 'failed'],
      [2, 'failed'],
      [3, 'failed'],
      [4, 'completed'],
    ]);
  });

  it('treats empty step input as the replay seed instead of falling back to final state', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayEmptyInput {
  step prepare {
    run = "./prepare.ts"
  }

  step flaky {
    run = "./flaky.ts"
  }
}
`,
    });
    let marker = 'old';
    let fail = true;
    const seenPrepareStates: Record<string, unknown>[] = [];
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: (context) => {
          seenPrepareStates.push({ ...context.state });
          return { marker };
        },
        flaky: () => {
          if (fail) throw new Error('first attempt failed');
          return { done: true };
        },
      },
    });
    const run = await runtime.enqueue('ReplayEmptyInput', {});
    await runtime.runUntilIdle();

    marker = 'new';
    fail = false;
    await runtime.replay(run.id, { mode: 'resume', fromStep: 'prepare' });
    await runtime.runUntilIdle();

    expect(seenPrepareStates[0]).toEqual({});
    expect(seenPrepareStates[1]).not.toMatchObject({ marker: 'old' });
    expect((await runtime.snapshot()).runs[0]).toMatchObject({
      status: 'completed',
      state: { marker: 'new', done: true },
    });
  });

  it('uses timer payload state when replaying from a timer node', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayTimerSeed {
  step prepare {
    run = "./prepare.ts"
  }

  timer wait {
    delay = "1s"
  }

  step notify {
    run = "./notify.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        prepare: () => ({ prepared: true }),
        notify: () => ({ notified: true }),
      },
    });
    const run = await runtime.enqueue('ReplayTimerSeed', {});
    await runtime.runUntilIdle();
    await runtime.resumeDueTimers(new Date(Date.now() + 2_000));
    await runtime.runUntilIdle();

    const replayed = await runtime.replay(run.id, { mode: 'fork', fromStep: 'wait' });

    expect(replayed).toMatchObject({
      status: 'queued',
      currentNode: 'timer:wait',
      state: { prepared: true },
    });
    expect(replayed.state).not.toMatchObject({ notified: true });
  });

  it('requires an active run lease when resuming paused runs', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ResumeLease {
  step wait {
    run = "./wait.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        wait: () => ({ waited: true }),
      },
    });
    const run = await runtime.enqueue('ResumeLease', {});
    await runtime.pause(run.id);
    await store.acquireLease({
      resourceType: 'run',
      resourceId: run.id,
      workerId: 'other_worker',
      ttlMs: 1_000,
      now: new Date(),
    });

    await expect(runtime.resume(run.id)).rejects.toThrow(
      `Workflow run ${run.id} is currently leased and cannot be resumed.`,
    );
  });

  it('does not manually resume runs paused for pending outbox dispatch', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ResumeOutboxWait {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });
    const run = await runtime.enqueue('ResumeOutboxWait', {});
    await runtime.runNext();

    await expect(runtime.resume(run.id)).rejects.toThrow('waiting for external outbox dispatch');
    expect((await runtime.snapshot()).outbox).toHaveLength(1);
  });

  it('does not replay-resume runs paused for pending outbox dispatch', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayResumeOutboxWait {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });
    const run = await runtime.enqueue('ReplayResumeOutboxWait', { id: 'evt_replay_outbox_wait' });
    await runtime.runNext();

    await expect(runtime.replay(run.id, { mode: 'resume', fromStep: 'submit' })).rejects.toThrow(
      'waiting for external outbox dispatch',
    );
    expect((await runtime.snapshot()).outbox).toHaveLength(1);
  });

  it('requires the active run lease when resolving approvals', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ApprovalLease {
  approval review {
    assignees = ["role:ops"]
  }
}
`,
    });
    const runtime = createWorkflowRuntime({ manifest: compiled.manifest, store });
    const run = await runtime.enqueue('ApprovalLease', {});
    await runtime.runUntilIdle();
    const approval = (await runtime.snapshot()).approvals[0]!;
    const wrongLease = await store.acquireLease({
      resourceType: 'outbox',
      resourceId: 'outbox_wrong_resource',
      workerId: 'worker_wrong',
      ttlMs: 1_000,
      now: new Date(0),
    });
    const wrongResource = await store.resolveApprovalIfPendingIfLeased({
      guard: {
        leaseId: wrongLease!.id,
        resourceType: 'outbox',
        resourceId: 'outbox_wrong_resource',
        workerId: 'worker_wrong',
        now: new Date(1),
      },
      approvalId: approval.id,
      runId: run.id,
      nodeId: approval.nodeId,
      status: 'approved',
      resolvedBy: 'ops@example.com',
    });
    expect(wrongResource).toBeUndefined();
    expect((await store.findApproval(approval.id))?.status).toBe('pending');

    const staleLease = await store.acquireLease({
      resourceType: 'run',
      resourceId: run.id,
      workerId: 'worker_a',
      ttlMs: 1_000,
      now: new Date(0),
    });
    await store.acquireLease({
      resourceType: 'run',
      resourceId: run.id,
      workerId: 'worker_b',
      ttlMs: 1_000,
      now: new Date(2_000),
    });

    const stale = await store.resolveApprovalIfPendingIfLeased({
      guard: {
        leaseId: staleLease!.id,
        resourceType: 'run',
        resourceId: run.id,
        workerId: 'worker_a',
        now: new Date(2_001),
      },
      approvalId: approval.id,
      runId: run.id,
      nodeId: approval.nodeId,
      status: 'approved',
      resolvedBy: 'ops@example.com',
    });

    expect(stale).toBeUndefined();
    expect((await store.findApproval(approval.id))?.status).toBe('pending');

    const staleSameWorkerLease = await store.acquireLease({
      resourceType: 'run',
      resourceId: run.id,
      workerId: 'worker_same',
      ttlMs: 1_000,
      now: new Date(4_000),
    });
    await store.acquireLease({
      resourceType: 'run',
      resourceId: run.id,
      workerId: 'worker_same',
      ttlMs: 1_000,
      now: new Date(6_000),
    });
    const staleSameWorker = await store.resolveApprovalIfPendingIfLeased({
      guard: {
        leaseId: staleSameWorkerLease!.id,
        resourceType: 'run',
        resourceId: run.id,
        workerId: 'worker_same',
        now: new Date(6_001),
      },
      approvalId: approval.id,
      runId: run.id,
      nodeId: approval.nodeId,
      status: 'approved',
      resolvedBy: 'ops@example.com',
    });

    expect(staleSameWorker).toBeUndefined();
    expect((await store.findApproval(approval.id))?.status).toBe('pending');
  });

  it('ignores stale approvals resolved after replay-resume', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ReplayApprovalEpoch {
  approval review {
    assignees = ["role:ops"]
    onApprove = afterApproval
  }

  step afterApproval {
    run = "./after-approval.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        afterApproval: () => ({ approved: true }),
      },
    });

    const run = await runtime.enqueue('ReplayApprovalEpoch', {});
    await runtime.runNext();
    const staleApproval = (await runtime.snapshot()).approvals[0]!;
    await runtime.replay(run.id, { mode: 'resume', fromStep: 'review' });
    await runtime.runNext();
    const currentApproval = (await runtime.snapshot()).approvals.find(
      (approval) => approval.id !== staleApproval.id && approval.status === 'pending',
    )!;

    await store.updateApproval(staleApproval.id, {
      status: 'approved',
      resolvedAt: new Date(),
      resolvedBy: 'late@example.com',
    });
    await runtime.runNext();

    expect(await store.findRun(run.id)).toMatchObject({
      status: 'waiting_for_approval',
      currentNode: 'approval:review',
    });
    expect((await store.findApproval(currentApproval.id))?.status).toBe('pending');
  });

  it('binds leased store mutations to the guarded resource', async () => {
    const store = new InMemoryWorkflowStore();
    const runA = await store.createRun({
      workflowId: 'workflow',
      versionId: 'version',
      status: 'queued',
      currentNode: 'step:a',
      input: {},
      state: {},
    });
    const runB = await store.createRun({
      workflowId: 'workflow',
      versionId: 'version',
      status: 'queued',
      currentNode: 'step:b',
      input: {},
      state: {},
    });
    const lease = await store.acquireLease({
      resourceType: 'run',
      resourceId: runA.id,
      workerId: 'worker_a',
      ttlMs: 1_000,
      now: new Date(0),
    });
    const guard = {
      leaseId: lease!.id,
      resourceType: 'run' as const,
      resourceId: runA.id,
      workerId: 'worker_a',
      now: new Date(1),
    };

    expect(
      await store.updateRunIfLeased({
        guard,
        runId: runB.id,
        patch: { status: 'failed' },
      }),
    ).toBeUndefined();
    expect(
      await store.createStepRunIfLeased({
        guard,
        step: {
          runId: runB.id,
          nodeId: 'step:b',
          stepName: 'b',
          attempt: 1,
          status: 'running',
        },
      }),
    ).toBeUndefined();
    expect(
      await store.appendTimelineIfLeased({
        guard,
        event: { runId: runB.id, type: 'WRONG_RUN' },
      }),
    ).toBeUndefined();
    expect(
      await store.appendSnapshotIfLeased({
        guard,
        snapshot: { runId: runB.id, state: { leaked: true } },
      }),
    ).toBeUndefined();
    expect(
      await store.createApprovalIfLeased({
        guard,
        approval: {
          runId: runB.id,
          nodeId: 'approval:b',
          approvalName: 'b',
          status: 'pending',
          assignees: [],
        },
      }),
    ).toBeUndefined();
    expect(
      await store.createTimerIfLeased({
        guard,
        timer: {
          runId: runB.id,
          nodeId: 'timer:b',
          resumeAt: new Date(),
          status: 'scheduled',
        },
      }),
    ).toBeUndefined();
    expect(
      await store.createOutboxIfLeased({
        guard,
        outbox: {
          runId: runB.id,
          nodeId: 'step:b',
          destination: './b.ts',
          payload: {},
          status: 'pending',
        },
      }),
    ).toBeUndefined();
    expect(
      await store.createDeadLetterIfLeased({
        guard,
        deadLetter: {
          kind: 'step',
          resourceId: runB.id,
          reason: 'wrong run',
        },
      }),
    ).toBeUndefined();

    const timer = await store.createTimer({
      runId: runB.id,
      nodeId: 'timer:b',
      resumeAt: new Date(),
      status: 'scheduled',
    });
    const outbox = await store.createOutbox({
      runId: runB.id,
      nodeId: 'step:b',
      destination: './b.ts',
      payload: {},
      status: 'pending',
    });

    expect(
      await store.updateTimerIfLeased({
        guard,
        timerId: timer.id,
        patch: { status: 'completed' },
      }),
    ).toBeUndefined();
    expect(
      await store.updateOutboxIfLeased({
        guard,
        outboxId: outbox.id,
        patch: { status: 'dispatched' },
      }),
    ).toBeUndefined();

    const snapshot = await store.snapshot();
    expect(snapshot.runs.find((run) => run.id === runB.id)?.status).toBe('queued');
    expect(snapshot.steps).toHaveLength(0);
    expect(snapshot.timeline).toHaveLength(0);
    expect(snapshot.snapshots).toHaveLength(0);
    expect(snapshot.approvals).toHaveLength(0);
    expect(snapshot.deadLetters).toHaveLength(0);
    expect(snapshot.timers.find((entry) => entry.id === timer.id)?.status).toBe('scheduled');
    expect(snapshot.outbox.find((entry) => entry.id === outbox.id)?.status).toBe('pending');
  });

  it('creates approvals for the current node even when stale approvals exist', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow CurrentApprovalNode {
  approval first {
    assignees = ["role:ops"]
  }

  approval second {
    assignees = ["role:ops"]
  }
}
`,
    });
    const runtime = createWorkflowRuntime({ manifest: compiled.manifest, store });
    const run = await runtime.enqueue('CurrentApprovalNode', {});
    await store.createApproval({
      runId: run.id,
      nodeId: 'approval:first',
      approvalName: 'first',
      status: 'pending',
      assignees: [],
    });
    await store.updateRun(run.id, {
      status: 'queued',
      currentNode: 'approval:second',
    });

    await runtime.runNext();

    const approvals = (await runtime.snapshot()).approvals;
    expect(approvals.map((approval) => approval.nodeId).sort()).toEqual([
      'approval:first',
      'approval:second',
    ]);
  });

  it('reconciles resolved approvals and completed timers back to queued runs', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ApprovalLostWakeup {
  approval review {
    assignees = ["role:ops"]
    onApprove = afterApproval
  }

  step afterApproval {
    run = "./after-approval.ts"
  }
}

workflow TimerLostWakeup {
  timer waitForLater {
    duration = "1h"
  }

  step afterTimer {
    run = "./after-timer.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        afterApproval: () => ({ approvedPath: true }),
        afterTimer: () => ({ timerPath: true }),
      },
    });

    const approvalRun = await runtime.enqueue('ApprovalLostWakeup', {});
    await runtime.runNext();
    const approval = (await runtime.snapshot()).approvals[0]!;
    await store.resolveApprovalIfPending({
      approvalId: approval.id,
      runId: approvalRun.id,
      nodeId: approval.nodeId,
      status: 'approved',
      resolvedBy: 'ops@example.com',
    });
    await runtime.runUntilIdle();
    expect((await store.findRun(approvalRun.id))?.state).toMatchObject({ approvedPath: true });

    const timerRun = await runtime.enqueue('TimerLostWakeup', {});
    await runtime.runNext();
    const timer = (await runtime.snapshot()).timers.find(
      (candidate) => candidate.runId === timerRun.id,
    )!;
    await store.updateTimer(timer.id, { status: 'completed' });
    await runtime.runUntilIdle();
    expect((await store.findRun(timerRun.id))?.state).toMatchObject({ timerPath: true });
  });

  it('fails closed when reconciling a resolved approval with an ambiguous branch layout', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow AmbiguousResolvedApproval {
  approval review {
    assignees = ["role:ops"]
    onApprove = approvedPath
    onReject = rejectedPath
  }

  step approvedPath {
    run = "./approved.ts"
  }

  step rejectedPath {
    run = "./rejected.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        approvedPath: () => ({ approvedPath: true }),
        rejectedPath: () => ({ rejectedPath: true }),
      },
    });

    const run = await runtime.enqueue('AmbiguousResolvedApproval', {});
    await runtime.runNext();
    const approval = (await runtime.snapshot()).approvals[0]!;
    await store.resolveApprovalIfPending({
      approvalId: approval.id,
      runId: run.id,
      nodeId: approval.nodeId,
      status: 'approved',
      resolvedBy: 'ops@example.com',
    });

    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(snapshot.runs[0]).toMatchObject({
      status: 'failed',
      error: { message: expect.stringContaining('ambiguous branch layout') },
    });
    expect(snapshot.steps).toHaveLength(0);
  });

  it('reconciles paused runs whose current step already completed or failed', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow PausedStepRecovery {
  step first {
    run = "./first.ts"
  }

  step second {
    run = "./second.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        second: () => ({ second: true }),
      },
    });

    const completedRun = await runtime.enqueue('PausedStepRecovery', {});
    await store.updateRun(completedRun.id, {
      status: 'paused',
      currentNode: 'step:first',
      state: {},
    });
    await store.createStepRun({
      runId: completedRun.id,
      nodeId: 'step:first',
      stepName: 'first',
      attempt: 1,
      status: 'completed',
      input: {},
      output: { first: true },
      completedAt: new Date(),
    });

    const failedRun = await runtime.enqueue('PausedStepRecovery', {});
    await store.updateRun(failedRun.id, {
      status: 'paused',
      currentNode: 'step:first',
      state: {},
    });
    await store.createStepRun({
      runId: failedRun.id,
      nodeId: 'step:first',
      stepName: 'first',
      attempt: 1,
      status: 'failed',
      input: {},
      error: { message: 'step crashed after status update' },
      completedAt: new Date(),
    });

    await runtime.runUntilIdle();

    const runsById = new Map((await runtime.snapshot()).runs.map((run) => [run.id, run]));
    expect(runsById.get(completedRun.id)).toMatchObject({
      status: 'completed',
      state: { first: true, second: true },
    });
    expect(runsById.get(failedRun.id)).toMatchObject({
      status: 'failed',
      error: { message: 'step crashed after status update' },
    });
  });

  it('retries external outbox dispatches before completing', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ExternalRetry {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
    retry = { maxAttempts = 3, backoff = "fixed" }
  }
}
`,
    });
    let calls = 0;
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        submit: () => {
          calls += 1;
          if (calls < 3) throw new Error(`temporary ${calls}`);
          return { submitted: true, calls };
        },
      },
    });

    await runtime.enqueue('ExternalRetry', { id: 'evt_external_retry' });
    await runtime.runUntilIdle();
    await runtime.dispatchNextOutbox(new Date(Date.now() + 1_000));
    await runtime.dispatchNextOutbox(new Date(Date.now() + 1_000));
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(calls).toBe(3);
    expect(snapshot.runs[0]).toMatchObject({
      status: 'completed',
      state: { submitted: true, calls: 3 },
    });
    expect(snapshot.steps.map((step) => [step.attempt, step.status])).toEqual([
      [1, 'failed'],
      [2, 'failed'],
      [3, 'completed'],
    ]);
    expect(snapshot.outbox[0]).toMatchObject({ status: 'dispatched', attempt: 3 });
    expect(
      snapshot.timeline.filter((event) => event.type === 'OUTBOX_RETRY_SCHEDULED'),
    ).toHaveLength(2);
    expect(snapshot.deadLetters).toHaveLength(0);
  });

  it('recovers external outbox dispatch from the latest running retry attempt', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ExternalRetryRecovery {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
    retry = { maxAttempts = 3, backoff = "fixed" }
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });

    const run = await runtime.enqueue('ExternalRetryRecovery', { id: 'evt_retry_recovery' });
    await runtime.runNext();
    const snapshot = await runtime.snapshot();
    const firstStep = snapshot.steps[0]!;
    await store.updateStepRun(firstStep.id, {
      status: 'failed',
      error: { message: 'crashed before outbox retry update' },
      completedAt: new Date(),
    });
    await store.createStepRun({
      runId: run.id,
      nodeId: firstStep.nodeId,
      stepName: firstStep.stepName,
      attempt: 2,
      status: 'running',
      input: snapshot.runs[0]!.state,
      startedAt: new Date(),
    });

    const completed = await runtime.dispatchNextOutbox();
    await runtime.runUntilIdle();

    expect(completed).toMatchObject({ status: 'queued', state: { submitted: true } });
    const recovered = await runtime.snapshot();
    expect(recovered.runs[0]).toMatchObject({ status: 'completed', state: { submitted: true } });
    expect(recovered.steps.map((step) => [step.attempt, step.status])).toEqual([
      [1, 'failed'],
      [2, 'completed'],
    ]);
    expect(recovered.outbox[0]).toMatchObject({ status: 'dispatched', attempt: 2 });
  });

  it('advances paused runs when recovering completed external outbox steps', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ExternalCompletedRecovery {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });

    const run = await runtime.enqueue('ExternalCompletedRecovery', {
      id: 'evt_completed_recovery',
    });
    await runtime.runNext();
    const snapshot = await runtime.snapshot();
    const firstStep = snapshot.steps[0]!;
    await store.updateStepRun(firstStep.id, {
      status: 'completed',
      output: { submitted: true },
      completedAt: new Date(),
    });

    const recovered = await runtime.dispatchNextOutbox();
    await runtime.runUntilIdle();

    expect(recovered).toMatchObject({ status: 'queued', state: { submitted: true } });
    expect((await store.findRun(run.id))?.status).toBe('completed');
    expect((await store.findRun(run.id))?.state).toMatchObject({ submitted: true });
    expect((await runtime.snapshot()).outbox[0]).toMatchObject({ status: 'dispatched' });
  });

  it('does not rewind runs that already advanced before outbox reconciliation', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ExternalAdvancedRecovery {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
  }

  step afterSubmit {
    run = "./after-submit.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        submit: () => ({ submitted: true }),
        afterSubmit: () => ({ afterSubmit: true }),
      },
    });

    const run = await runtime.enqueue('ExternalAdvancedRecovery', {
      id: 'evt_advanced_recovery',
    });
    await runtime.runNext();
    const snapshot = await runtime.snapshot();
    const firstStep = snapshot.steps[0]!;
    await store.updateStepRun(firstStep.id, {
      status: 'completed',
      output: { submitted: true },
      completedAt: new Date(),
    });
    await store.updateRun(run.id, {
      status: 'queued',
      currentNode: 'step:afterSubmit',
      state: { id: 'evt_advanced_recovery', submitted: true },
    });

    const recovered = await runtime.dispatchNextOutbox();

    expect(recovered).toMatchObject({
      status: 'queued',
      currentNode: 'step:afterSubmit',
      state: { id: 'evt_advanced_recovery', submitted: true },
    });
    await runtime.runUntilIdle();
    expect((await store.findRun(run.id))?.state).toMatchObject({
      submitted: true,
      afterSubmit: true,
    });
  });

  it('reconciles pending outbox entries for terminal runs', async () => {
    const store = new InMemoryWorkflowStore();
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ExternalTerminalRecovery {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      store,
      steps: {
        submit: () => ({ submitted: true }),
      },
    });

    const run = await runtime.enqueue('ExternalTerminalRecovery', { id: 'evt_terminal_recovery' });
    await runtime.runNext();
    await store.updateRun(run.id, {
      status: 'failed',
      error: { message: 'crashed after run failure before outbox failure' },
      completedAt: new Date(),
    });

    const recovered = await runtime.dispatchNextOutbox();

    expect(recovered).toMatchObject({
      status: 'failed',
      error: { message: 'crashed after run failure before outbox failure' },
    });
    expect((await runtime.snapshot()).outbox[0]).toMatchObject({ status: 'failed' });
  });

  it('dead-letters external outbox dispatches after max attempts', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ExternalRetryFailure {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
    retry = { maxAttempts = 2, backoff = "fixed" }
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        submit: () => {
          throw new Error('provider down');
        },
      },
    });

    await runtime.enqueue('ExternalRetryFailure', { id: 'evt_external_failure' });
    await runtime.runUntilIdle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runtime.dispatchNextOutbox();

    const snapshot = await runtime.snapshot();
    expect(snapshot.runs[0]).toMatchObject({
      status: 'failed',
      error: { message: 'provider down' },
    });
    expect(snapshot.steps.map((step) => [step.attempt, step.status])).toEqual([
      [1, 'failed'],
      [2, 'failed'],
    ]);
    expect(snapshot.outbox[0]).toMatchObject({ status: 'failed', attempt: 2 });
    expect(snapshot.deadLetters).toHaveLength(1);

    const duplicate = await runtime.enqueue('ExternalRetryFailure', { id: 'evt_external_failure' });
    await runtime.runUntilIdle();
    const duplicateRun = (await runtime.snapshot()).runs.find(
      (candidate) => candidate.id === duplicate.id,
    );
    expect(duplicateRun?.status).toBe('failed');
    expect((await runtime.snapshot()).outbox).toHaveLength(1);
  });

  it('dead-letters manual context outbox rows instead of marking them dispatched', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ManualOutbox {
  step emit {
    run = "./emit.ts"
  }

  timer wait {
    duration = "1h"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        emit: async (context) => {
          await context.outbox({ destination: 'email.send', payload: { to: 'ops@example.com' } });
          return { emitted: true };
        },
      },
    });

    await runtime.enqueue('ManualOutbox', {});
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(snapshot.runs[0]).toMatchObject({ status: 'waiting_for_timer' });
    expect(snapshot.outbox[0]).toMatchObject({ status: 'failed' });
    expect(snapshot.deadLetters).toHaveLength(1);
  });

  it('dead-letters manual outbox rows emitted by terminal runs', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow TerminalManualOutbox {
  step emit {
    run = "./emit.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        emit: async (context) => {
          await context.outbox({ destination: 'email.send', payload: { to: 'ops@example.com' } });
          return { emitted: true };
        },
      },
    });

    await runtime.enqueue('TerminalManualOutbox', {});
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    expect(snapshot.runs[0]).toMatchObject({ status: 'completed', state: { emitted: true } });
    expect(snapshot.outbox[0]).toMatchObject({ status: 'failed' });
    expect(snapshot.deadLetters).toHaveLength(1);
  });

  it('does not dispatch the same outbox concurrently for one worker', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ExternalConcurrentDispatch {
  step submit {
    run = "./submit.ts"
    sideEffects = "external"
    idempotency = "state.id"
  }
}
`,
    });
    let calls = 0;
    let releaseHandler: (() => void) | undefined;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        submit: async () => {
          calls += 1;
          await handlerGate;
          return { submitted: true };
        },
      },
    });

    await runtime.enqueue('ExternalConcurrentDispatch', { id: 'evt_concurrent_dispatch' });
    await runtime.runNext();
    const first = runtime.dispatchNextOutbox();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = runtime.dispatchNextOutbox();
    releaseHandler?.();
    const results = await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('verifies connector webhooks before durable HTTP ingest', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ConnectorWebhook {
  trigger eventCreated {
    source = "stripe"
    event = "event.created"
  }

  step record {
    run = "./record.ts"
  }
}
`,
    });
    const stripe = defineConnector({
      id: 'stripe',
      events: {
        'event.created': defineEvent({
          verify: ({ headers }) => headers['x-test-signature'] === 'valid',
          dedupeKey: ({ event }) => `stripe:${String(recordFromJson(event)['id'])}`,
          normalize: ({ event }) => ({
            type: 'event.created',
            externalId: String(recordFromJson(event)['id']),
            payload: { normalized: true, ...recordFromJson(event) },
          }),
        }),
      },
    });
    const app = createWorkflowHttpApp({
      manifest: compiled.manifest,
      connectors: { stripe },
      steps: {
        record: (context) => ({ seen: recordFromJson(context.state)['normalized'] }),
      },
    });

    const denied = await app.fetch(
      new Request('https://example.test/api/prisma-workflows/ingest/stripe/acct_1', {
        method: 'POST',
        headers: { 'x-test-signature': 'invalid' },
        body: JSON.stringify({ type: 'event.created', payload: { id: 'evt_connector' } }),
      }),
    );
    const accepted = await app.fetch(
      new Request('https://example.test/api/prisma-workflows/ingest/stripe/acct_1', {
        method: 'POST',
        headers: { 'x-test-signature': 'valid' },
        body: JSON.stringify({ type: 'event.created', payload: { id: 'evt_connector' } }),
      }),
    );
    const acceptedBody = recordFromJson(await accepted.json());
    const runResponse = recordFromJson(
      await (
        await app.fetch(
          new Request('https://example.test/api/prisma-workflows/run', { method: 'POST' }),
        )
      ).json(),
    );
    const studio = recordFromJson(
      await (
        await app.fetch(new Request('https://example.test/api/prisma-workflows/studio'))
      ).json(),
    );
    const datasets = recordFromJson(studio['datasets']);
    const ingestEvents = datasets['ingestEvents'];
    const processedRuns = runResponse['processedRuns'];

    expect(denied.status).toBe(401);
    expect(accepted.status).toBe(202);
    expect(acceptedBody['duplicate']).toBe(false);
    expect(Array.isArray(processedRuns)).toBe(true);
    expect(
      recordFromJson(Array.isArray(processedRuns) ? processedRuns[0] : undefined),
    ).toMatchObject({
      status: 'completed',
      state: { normalized: true, seen: true },
    });
    expect(Array.isArray(ingestEvents)).toBe(true);
    expect(recordFromJson(Array.isArray(ingestEvents) ? ingestEvents[0] : undefined)).toMatchObject(
      {
        dedupeKey: 'stripe:acct_1:event.created:stripe:evt_connector',
        signatureVerified: true,
      },
    );
  });
});

class DelayedUpsertStore extends InMemoryWorkflowStore implements WorkflowStore {
  upsertCompleted = false;

  override async upsertDefinitions(
    workflows: Parameters<WorkflowStore['upsertDefinitions']>[0],
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await super.upsertDefinitions(workflows);
    this.upsertCompleted = true;
  }
}

function firstRunId(value: unknown): string {
  const body = recordFromJson(value);
  const runs = body['runs'];
  if (!Array.isArray(runs)) {
    throw new Error('Expected HTTP response body to include runs array');
  }
  const firstRun = recordFromJson(runs[0]);
  const id = firstRun['id'];
  if (typeof id !== 'string') {
    throw new Error('Expected HTTP response run to include string id');
  }
  return id;
}

function recordFromJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected JSON object');
  }
  return Object.fromEntries(Object.entries(value));
}
