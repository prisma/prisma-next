import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileWorkflowSchema } from '../src/compiler/compile';
import { renderWorkflowArtifacts } from '../src/compiler/generate';
import { quoteWorkflowSqlIdentifier, renderWorkflowSqlDdl } from '../src/compiler/sql-ddl';

const schema = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

model DisputeCase {
  id String @id
}

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
    run = "./workflows/stripe-dispute/load-customer.ts"
    timeout = "30s"
    retry = { maxAttempts = 3, backoff = "exponential" }
  }

  step draftEvidence {
    run = "./workflows/stripe-dispute/draft-evidence.ts"
    checkpoint = true
    budget = { maxUsd = 0.25 }
  }

  approval approveEvidence {
    when = "state.amount > 500 || state.confidence < 0.85"
    timeout = "24h"
    assignees = ["role:finance_ops"]
    onApprove = submitEvidence
    onReject = notifySupport
  }

  step submitEvidence {
    run = "./workflows/stripe-dispute/submit-evidence.ts"
    sideEffects = "external"
    idempotency = "state.disputeId"
  }

  step notifySupport {
    run = "./workflows/stripe-dispute/notify-support.ts"
  }
}
`;

describe('compileWorkflowSchema', () => {
  it('compiles native workflow PSL into Workflow IR', () => {
    const result = compileWorkflowSchema({ schema, sourceId: 'contract.prisma' });

    expect(result.ok).toBe(true);
    expect(result.ast.prismaBlocks?.map((block) => block.keyword)).toEqual([
      'generator',
      'datasource',
    ]);
    const workflow = result.manifest.workflows[0];
    expect(workflow?.name).toBe('StripeDisputeResponse');
    expect(workflow?.slug).toBe('stripe-dispute-response');
    expect(workflow?.triggers[0]).toMatchObject({
      source: 'stripe',
      event: 'charge.dispute.created',
      dedupeBy: 'event.id',
    });
    expect(workflow?.nodes.map((node) => node.name)).toEqual([
      'loadCustomer',
      'draftEvidence',
      'approveEvidence',
      'submitEvidence',
      'notifySupport',
    ]);
    expect(workflow?.canvas.nodes.some((node) => node.kind === 'approval')).toBe(true);
    expect(workflow?.connectors[0]).toMatchObject({
      connector: 'stripe',
      events: ['charge.dispute.created'],
    });
    expect(workflow?.nodes.find((node) => node.name === 'submitEvidence')).toMatchObject({
      sideEffects: 'external',
      idempotency: 'state.disputeId',
    });
    expect(workflow?.nodes.find((node) => node.name === 'approveEvidence')).toMatchObject({
      assignees: ['role:finance_ops'],
      onApprove: 'submitEvidence',
      onReject: 'notifySupport',
    });
    expect(workflow?.canvas.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'approval:approveEvidence',
          to: 'step:submitEvidence',
          label: 'approve',
        }),
        expect.objectContaining({
          from: 'approval:approveEvidence',
          to: 'step:notifySupport',
          label: 'reject',
        }),
      ]),
    );
  });

  it('renders generated artifacts and workflow DDL', () => {
    const result = compileWorkflowSchema({ schema, sourceId: 'contract.prisma' });
    const artifacts = renderWorkflowArtifacts(result.manifest, {
      outputDir: '/tmp/prisma-next-workflows/src/generated/workflows',
      schemaPath: '/tmp/prisma-next-workflows/contract.prisma',
    });

    expect(artifacts.manifestJson).toContain('"prisma-workflow-manifest"');
    expect(artifacts.indexTs).toContain('createWorkflowRuntime');
    expect(artifacts.indexTs).toContain('createWorkflowClient');
    expect(artifacts.indexTs).toContain('client:');
    expect(artifacts.indexTs).toContain('"StripeDisputeResponse": {');
    expect(artifacts.indexTs).toContain('\n  "workflows": [');
    expect(artifacts.typesDts).toContain('StripeDisputeResponseState');
    expect(artifacts.typesDts).toContain('export type TypedWorkflowClient');
    expect(artifacts.typesDts).toContain(
      'enqueue(input: StripeDisputeResponseInput): Promise<WorkflowRunRecord>;',
    );
    expect(artifacts.computeTs).toContain('PostgresWorkflowStore');
    expect(artifacts.computeTs).toContain(
      'import * as stepModule1 from "../../../workflows/stripe-dispute/load-customer";',
    );
    expect(artifacts.computeTs).toContain('"loadCustomer": pickStep(stepModule1, "loadCustomer"),');
    expect(artifacts.studioJson).toContain('prisma-workflow-studio-model');
    expect(artifacts.studioJson).toContain('"inspectRun": "/api/prisma-workflows/inspect/:runId"');
    expect(artifacts.studioJson).toContain('"timeline"');
    expect(renderWorkflowSqlDdl()).toContain('"WorkflowRun"');
    expect(renderWorkflowSqlDdl()).toContain('"WorkflowApproval"');
    expect(renderWorkflowSqlDdl()).toContain('assignees jsonb');
    expect(renderWorkflowSqlDdl()).toContain(
      'ALTER TABLE "_prisma_workflows"."WorkflowApproval"\n  ADD COLUMN IF NOT EXISTS payload jsonb;',
    );
    expect(quoteWorkflowSqlIdentifier('workflow"runtime')).toBe('"workflow""runtime"');
    expect(renderWorkflowSqlDdl('workflow"runtime')).toContain(
      'CREATE SCHEMA IF NOT EXISTS "workflow""runtime"',
    );
  });

  it('renders connector bindings into generated Compute apps', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'prisma-workflows-'));
    await mkdir(join(tempDir, 'connectors'));
    await writeFile(
      join(tempDir, 'connectors', 'stripe.ts'),
      'export const connector = { id: "stripe" };\n',
    );
    const result = compileWorkflowSchema({ schema, sourceId: join(tempDir, 'contract.prisma') });
    const artifacts = renderWorkflowArtifacts(result.manifest, {
      outputDir: join(tempDir, 'src/generated/workflows'),
      schemaPath: join(tempDir, 'contract.prisma'),
    });

    expect(artifacts.computeTs).toContain('ConnectorDefinition');
    expect(artifacts.computeTs).toContain(
      'import * as connectorModule1 from "../../../connectors/stripe";',
    );
    expect(artifacts.computeTs).toContain('"stripe": pickConnector(connectorModule1, "stripe"),');
    expect(artifacts.computeTs).toContain(
      'connectors: { ...connectors, ...(options.connectors ?? {}) }',
    );
    expect(artifacts.computeTs).toContain('export function createApp');
  });

  it('rejects parallel workflows until runtime semantics are executable', () => {
    const result = compileWorkflowSchema({
      sourceId: 'contract.prisma',
      schema: `
workflow UnsupportedParallel {
  parallel fanOut {
    branches = ["a", "b"]
  }

  step a {
    run = "./a.ts"
  }

  step b {
    run = "./b.ts"
  }
}
`,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      'parallel "fanOut" is parsed for forward compatibility but is not executable in this Prisma Workflows MVP; model each branch as explicit steps for now',
    );
  });

  it('reports source-located semantic diagnostics for invalid workflow DX', () => {
    const result = compileWorkflowSchema({
      sourceId: 'schema.prisma',
      schema: `
workflow BrokenWorkflow {
  trigger stripeEvent {
    source = "stripe"
  }

  step submitEvidence {
    sideEffects = "external"
    retry = { maxAttempts: 0, backoff: "sometimes" }
    budget = { timeout: "soon" }
  }

  approval review {
    onApprove = missingStep
  }

  timer wait {
  }
}
`,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('trigger "stripeEvent" must declare string property `event`'),
        expect.stringContaining('step "submitEvidence" must declare string property `run`'),
        expect.stringContaining('external side effects'),
        expect.stringContaining('retry.maxAttempts'),
        expect.stringContaining('retry.backoff'),
        expect.stringContaining('budget.timeout'),
        expect.stringContaining('unknown workflow node "missingStep"'),
        expect.stringContaining('Timer "wait" must declare either `delay` or `resumeAt`'),
      ]),
    );
    expect(result.diagnostics.every((diagnostic) => diagnostic.sourceId === 'schema.prisma')).toBe(
      true,
    );
    expect(result.diagnostics.every((diagnostic) => diagnostic.span.start.line > 0)).toBe(true);
  });
});
