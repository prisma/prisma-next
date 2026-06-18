import { readFile } from 'node:fs/promises';
import { compileWorkflowSchema } from '@prisma-next/workflows/compiler';
import { createWorkflowRuntime, InMemoryWorkflowStore } from '@prisma-next/workflows/runtime';
import { describe, expect, test } from 'vitest';
import { createOnboardingWorkflowHandlers } from '../src/handlers';
import { createMockOnboardingProviders } from '../src/mock-providers';

const schemaPath = new URL('../src/schema.prisma', import.meta.url);
const fixturePath = new URL('../fixtures/account-created.json', import.meta.url);

describe('customer onboarding workflow', () => {
  test('enriches, scores, gates risky accounts, provisions, and notifies', async () => {
    const schema = await readFile(schemaPath, 'utf8');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
    if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
      throw new Error('fixture must be a JSON object');
    }
    const { manifest } = compileWorkflowSchema({ schema, sourceId: schemaPath.pathname });
    const runtime = createWorkflowRuntime({
      manifest,
      store: new InMemoryWorkflowStore(),
      steps: createOnboardingWorkflowHandlers(createMockOnboardingProviders()),
    });

    const ingest = await runtime.ingest({
      source: 'product',
      eventType: 'account.created',
      payload: fixture,
    });
    expect(ingest.matchedWorkflows).toEqual(['OnboardingRiskReview']);

    const [blocked] = await runtime.runUntilIdle();
    expect(blocked?.status).toBe('waiting_for_approval');
    expect(blocked?.state['riskScore']).toBeGreaterThan(0.7);

    const approval = (await runtime.snapshot()).approvals[0];
    const completed = await runtime.approve(approval!.id, {
      approvedBy: 'sales-ops@example.com',
      reason: 'Enterprise account validated.',
    });

    expect(completed.status).toBe('completed');
    expect(completed.state['workspace']).toMatchObject({ workspaceId: 'workspace_acct_001' });
    expect(completed.state['slackMessage']).toMatchObject({ channel: '#onboarding' });
  });
});
