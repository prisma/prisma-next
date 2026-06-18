import { describe, expect, it } from 'vitest';
import { compileWorkflowSchema } from '../src/compiler/compile';
import {
  createMockDisputeConnectors,
  stripeDisputeCreatedFixture,
} from '../src/connectors/mock-providers';
import { createWorkflowRuntime } from '../src/runtime/engine';
import { InMemoryWorkflowStore } from '../src/runtime/store';
import { buildWorkflowStudioModel } from '../src/studio/model';
import { renderWorkflowCanvasSvg, renderWorkflowStudioHtml } from '../src/studio/render';

const schema = `
workflow StripeDisputeResponse {
  trigger stripeDisputeCreated {
    source = stripe
    event = "charge.dispute.created"
  }

  step loadCustomer {
    run = "./load-customer.ts"
  }

  approval approveEvidence {
    when = "state.amount > 500"
  }
}
`;

describe('workflow studio model', () => {
  it('builds embeddable Studio data and static visuals', async () => {
    const compiled = compileWorkflowSchema({ schema, sourceId: 'contract.prisma' });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: createMockDisputeConnectors(),
    });

    await runtime.ingest({
      source: 'stripe',
      eventType: 'charge.dispute.created',
      payload: stripeDisputeCreatedFixture(),
    });
    await runtime.runUntilIdle();

    const snapshot = await runtime.snapshot();
    const model = buildWorkflowStudioModel(compiled.manifest, snapshot);
    const svg = renderWorkflowCanvasSvg(compiled.manifest.workflows[0]!.canvas);
    const html = renderWorkflowStudioHtml(compiled.manifest, snapshot);

    expect(model.workflows[0]?.runsToday).toBe(1);
    expect(model.workflows[0]?.overlays[0]?.nodes['step:loadCustomer']?.status).toBe('succeeded');
    expect(model.workflows[0]?.timelineFrames.map((frame) => frame.eventType)).toContain(
      'APPROVAL_REQUESTED',
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('approveEvidence');
    expect(html).toContain('Prisma Workflows');
    expect(html).toContain('Runs today');
    expect(html).toContain('Timeline');
  });

  it('keeps timeline frames from showing future step state', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow TimelineReview {
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
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        first: () => ({ first: true }),
        second: () => ({ second: true }),
        third: () => ({ third: true }),
      },
    });

    await runtime.enqueue('TimelineReview', {});
    await runtime.runUntilIdle();

    const model = buildWorkflowStudioModel(compiled.manifest, await runtime.snapshot());
    const firstStarted = model.workflows[0]?.timelineFrames.find(
      (frame) => frame.eventType === 'STEP_STARTED' && frame.nodeId === 'step:first',
    );
    const firstCompleted = model.workflows[0]?.timelineFrames.find(
      (frame) => frame.eventType === 'STEP_COMPLETED' && frame.nodeId === 'step:first',
    );

    expect(firstStarted?.overlay.nodes['step:third']?.status).toBe('not_started');
    expect(firstStarted?.overlay.nodes['step:first']?.status).toBe('running');
    expect(firstStarted?.overlay.nodes['step:first']?.completedAt).toBeUndefined();
    expect(firstStarted?.overlay.nodes['step:first']?.durationMs).toBeUndefined();
    expect(firstStarted?.overlay.nodes['step:first']?.outputRef).toBeUndefined();
    expect(firstStarted?.overlay.nodes['step:first']?.stateDiff).toBeUndefined();
    expect(firstStarted?.state).toBeUndefined();
    expect(firstCompleted?.state).toMatchObject({ first: true });
    expect(firstCompleted?.overlay.nodes['step:first']?.outputRef).toBeDefined();
    expect(firstCompleted?.overlay.nodes['step:third']?.status).toBe('not_started');
  });

  it('keeps pending approval frames from showing future resolution fields', async () => {
    const compiled = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow ApprovalTimeline {
  approval review {
    assignees = ["role:ops"]
  }

  step after {
    run = "./after.ts"
  }
}
`,
    });
    const runtime = createWorkflowRuntime({
      manifest: compiled.manifest,
      steps: {
        after: () => ({ after: true }),
      },
    });

    await runtime.enqueue('ApprovalTimeline', {});
    await runtime.runUntilIdle();
    const approval = (await runtime.snapshot()).approvals[0]!;
    await runtime.approve(approval.id, { approvedBy: 'ops@example.com' });

    const model = buildWorkflowStudioModel(compiled.manifest, await runtime.snapshot());
    const requested = model.workflows[0]?.timelineFrames.find(
      (frame) => frame.eventType === 'APPROVAL_REQUESTED',
    );
    const approved = model.workflows[0]?.timelineFrames.find(
      (frame) => frame.eventType === 'APPROVAL_APPROVED',
    );

    expect(requested?.overlay.nodes['approval:review']?.status).toBe('waiting');
    expect(requested?.overlay.nodes['approval:review']?.completedAt).toBeUndefined();
    expect(approved?.overlay.nodes['approval:review']?.status).toBe('succeeded');
    expect(approved?.overlay.nodes['approval:review']?.completedAt).toBeDefined();
  });

  it('renders historical runs with their stored workflow version', async () => {
    const store = new InMemoryWorkflowStore();
    const v1 = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow VersionedStudio {
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
        oldStep: () => ({ old: true }),
      },
    });
    const oldRun = await runtimeV1.enqueue('VersionedStudio', {});
    await runtimeV1.runUntilIdle();

    const v2 = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow VersionedStudio {
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
        newStep: () => ({ new: true }),
      },
    });
    await runtimeV2.enqueue('VersionedStudio', {});
    await runtimeV2.runUntilIdle();

    const model = buildWorkflowStudioModel(v2.manifest, await runtimeV2.snapshot());
    const oldOverlay = model.workflows[0]?.overlays.find((overlay) => overlay.runId === oldRun.id);

    expect(oldOverlay?.nodes['step:oldStep']?.status).toBe('succeeded');
    expect(oldOverlay?.nodes['step:newStep']).toBeUndefined();
  });

  it('keeps runs for workflows removed from the current manifest', async () => {
    const store = new InMemoryWorkflowStore();
    const v1 = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow RemovedWorkflow {
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
        oldStep: () => ({ old: true }),
      },
    });
    const oldRun = await runtimeV1.enqueue('RemovedWorkflow', {});
    await runtimeV1.runUntilIdle();
    const v2 = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow CurrentWorkflow {
  step currentStep {
    run = "./current-step.ts"
  }
}
`,
    });

    const model = buildWorkflowStudioModel(v2.manifest, await store.snapshot());
    const removed = model.workflows.find((workflow) => workflow.id === 'removed-workflow');

    expect(removed?.runs.map((run) => run.id)).toContain(oldRun.id);
    expect(removed?.overlays[0]?.nodes['step:oldStep']?.status).toBe('succeeded');
  });
});
