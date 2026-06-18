import { readFile } from 'node:fs/promises';
import { compileWorkflowSchema } from '@prisma-next/workflows/compiler';
import { createWorkflowRuntime, InMemoryWorkflowStore } from '@prisma-next/workflows/runtime';
import { describe, expect, test } from 'vitest';
import { createDisputeWorkflowHandlers } from '../src/handlers';
import { createMockDisputeProviders } from '../src/mock-providers';

const schemaPath = new URL('../src/schema.prisma', import.meta.url);
const fixturePath = new URL('../fixtures/stripe-dispute-created.json', import.meta.url);

describe('Stripe dispute workflow', () => {
  test('collects evidence, waits for approval, submits, posts, and learns', async () => {
    const schema = await readFile(schemaPath, 'utf8');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
    if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
      throw new Error('fixture must be a JSON object');
    }
    const { manifest } = compileWorkflowSchema({ schema, sourceId: schemaPath.pathname });
    const store = new InMemoryWorkflowStore();
    const runtime = createWorkflowRuntime({
      manifest,
      store,
      steps: createDisputeWorkflowHandlers(createMockDisputeProviders()),
    });

    const ingest = await runtime.ingest({
      source: 'stripe',
      eventType: 'charge.dispute.created',
      payload: fixture,
    });
    expect(ingest.matchedWorkflows).toEqual(['DisputeEvidence']);

    const [blocked] = await runtime.runUntilIdle();
    expect(blocked?.status).toBe('waiting_for_approval');

    const blockedSnapshot = await runtime.snapshot();
    const approval = blockedSnapshot.approvals[0];
    expect(approval?.approvalName).toBe('humanApproval');

    const completed = await runtime.approve(approval!.id, {
      approvedBy: 'agent@example.com',
      reason: 'Evidence matches fulfillment records.',
    });
    expect(completed.status).toBe('completed');
    expect(completed.state['evidenceId']).toBe('evidence_du_001');
    expect(completed.state['approvedResponse']).toContain('tracking');

    const snapshot = await runtime.snapshot();
    expect(snapshot.timeline.map((event) => event.type)).toContain('STEP_COMPLETED');
    expect(snapshot.deadLetters).toHaveLength(0);
  });
});
