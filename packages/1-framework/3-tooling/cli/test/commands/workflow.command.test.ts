import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkflowCommand } from '../../src/commands/workflow';
import {
  executeCommand,
  parseJsonObjectFromCliCapture,
  setupCommandMocks,
} from '../utils/test-helpers';

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected a JSON object');
  }
  return Object.fromEntries(Object.entries(value));
}

describe('createWorkflowCommand', () => {
  const originalCwd = process.cwd();
  let tempDir: string | undefined;
  let consoleOutput: string[] = [];
  let cleanupMocks: () => void = () => {};

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'prisma-next-workflow-cli-'));
    process.chdir(tempDir);
    const commandMocks = setupCommandMocks();
    consoleOutput = commandMocks.consoleOutput;
    cleanupMocks = commandMocks.cleanup;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    cleanupMocks();
    if (tempDir !== undefined) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('scaffolds a starter workflow schema and fixture', async () => {
    await executeCommand(createWorkflowCommand(), ['init', '--json']);

    const result = recordValue(parseJsonObjectFromCliCapture(consoleOutput));
    expect(result).toMatchObject({
      schemaPath: 'prisma/schema.prisma',
      fixturePath: 'prisma/workflows/fixtures/stripe-dispute-created.json',
      schemaStatus: 'created',
      fixtureStatus: 'created',
    });
    expect(result['commands']).toEqual([
      'prisma-next workflow generate --schema prisma/schema.prisma',
      'prisma-next workflow test --schema prisma/schema.prisma --payload prisma/workflows/fixtures/stripe-dispute-created.json --mock',
      'prisma-next workflow inspect --schema prisma/schema.prisma --studio .prisma-next/workflows/studio.html',
    ]);

    const schema = await readFile(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    expect(schema).toContain('workflow StripeDisputeResponse');
    expect(schema).toContain('approval humanApproval');

    const fixture = await readFile(
      join(process.cwd(), 'prisma/workflows/fixtures/stripe-dispute-created.json'),
      'utf8',
    );
    expect(fixture).toContain('"charge.dispute.created"');
  });

  it('reports source-located workflow diagnostics', async () => {
    await mkdir(join(process.cwd(), 'prisma'), { recursive: true });
    const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
    await writeFile(
      schemaPath,
      `workflow Broken {
  notAWorkflowMember
}
`,
    );

    let caught: unknown;
    try {
      await executeCommand(createWorkflowCommand(), ['compile', '--schema', schemaPath]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof Error) {
      expect(caught.message).toContain('Workflow schema has 1 diagnostic(s):');
      expect(caught.message).toContain('[PSL_INVALID_WORKFLOW_MEMBER]');
      expect(caught.message).toContain(
        'Fix the schema and rerun `prisma-next workflow compile --schema',
      );
    }
  });

  it('runs fixture tests through real step modules by default', async () => {
    await mkdir(join(process.cwd(), 'prisma'), { recursive: true });
    await mkdir(join(process.cwd(), 'steps'), { recursive: true });
    const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
    const payloadPath = join(process.cwd(), 'event.json');
    await writeFile(
      schemaPath,
      `workflow LocalModule {
  trigger eventCreated {
    source = "test"
    event = "event.created"
  }

  step record {
    run = "./steps/record.mjs"
  }
}
`,
    );
    await writeFile(
      join(process.cwd(), 'steps/record.mjs'),
      `export default async function record(context) {
  return { fromModule: true, inputId: context.input.id };
}
`,
    );
    await writeFile(
      payloadPath,
      `${JSON.stringify({ id: 'evt_module', type: 'event.created' })}\n`,
    );

    await executeCommand(createWorkflowCommand(), [
      'test',
      '--schema',
      schemaPath,
      '--payload',
      payloadPath,
      '--json',
    ]);

    const result = recordValue(parseJsonObjectFromCliCapture(consoleOutput));
    const store = recordValue(result['store']);
    const runs = store['runs'];
    expect(Array.isArray(runs)).toBe(true);
    if (Array.isArray(runs)) {
      expect(runs[0]).toMatchObject({
        status: 'completed',
        state: { fromModule: true, inputId: 'evt_module' },
      });
    }
  });

  it('prepares dev artifacts without starting a server in once mode', async () => {
    await mkdir(join(process.cwd(), 'prisma'), { recursive: true });
    const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
    await writeFile(
      schemaPath,
      `workflow LocalDev {
  step record {
    run = "./steps/record.mjs"
  }
}
`,
    );

    await executeCommand(createWorkflowCommand(), [
      'dev',
      '--schema',
      schemaPath,
      '--output',
      'generated/workflows',
      '--once',
      '--json',
    ]);

    const result = recordValue(parseJsonObjectFromCliCapture(consoleOutput));
    expect(result).toMatchObject({
      workflowCount: 1,
      server: null,
    });
    expect(
      await readFile(join(process.cwd(), 'generated/workflows/manifest.json'), 'utf8'),
    ).toContain('"LocalDev"');
    expect(
      await readFile(join(process.cwd(), 'generated/workflows/studio.html'), 'utf8'),
    ).toContain('Prisma Workflows Studio');
  });

  it('uses generator workflows defaults for output and runtime schema', async () => {
    await mkdir(join(process.cwd(), 'prisma'), { recursive: true });
    const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
    await writeFile(
      schemaPath,
      `generator workflows {
  provider = "prisma-workflows"
  output = "../generated/workflows"
  schema = "workflow_runtime"
}

workflow GeneratedDefaults {
  step record {
    run = "./steps/record.mjs"
  }
}
`,
    );

    await executeCommand(createWorkflowCommand(), ['generate', '--schema', schemaPath, '--json']);

    const result = recordValue(parseJsonObjectFromCliCapture(consoleOutput));
    expect(result['outputDir']).toBe(join(process.cwd(), 'generated/workflows'));
    expect(
      await readFile(join(process.cwd(), 'generated/workflows/manifest.json'), 'utf8'),
    ).toContain('"GeneratedDefaults"');
    expect(await readFile(join(process.cwd(), 'generated/workflows/schema.sql'), 'utf8')).toContain(
      'CREATE SCHEMA IF NOT EXISTS "workflow_runtime"',
    );
    expect(await readFile(join(process.cwd(), 'generated/workflows/compute.ts'), 'utf8')).toContain(
      'schemaName: "workflow_runtime"',
    );
  });

  it('does not discover markdown workflow PRDs as schemas', async () => {
    await mkdir(join(process.cwd(), 'examples'), { recursive: true });
    await writeFile(join(process.cwd(), 'examples/workflows.md'), '# Workflows PRD\n');

    let caught: unknown;
    try {
      await executeCommand(createWorkflowCommand(), ['compile']);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof Error) {
      expect(caught.message).toContain('No workflow schema found');
      expect(caught.message).not.toContain('Workflow schema has');
    }
  });

  it('plans payload backfill until --run is explicit', async () => {
    await mkdir(join(process.cwd(), 'prisma'), { recursive: true });
    const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
    const payloadPath = join(process.cwd(), 'event.json');
    await writeFile(
      schemaPath,
      `workflow BackfillPlan {
  trigger eventCreated {
    source = "stripe"
    event = "event.created"
  }

  step record {
    run = "./steps/record.mjs"
  }
}
`,
    );
    await writeFile(payloadPath, `${JSON.stringify({ id: 'evt_backfill' })}\n`);

    await executeCommand(createWorkflowCommand(), [
      'backfill',
      '--schema',
      schemaPath,
      '--payload',
      payloadPath,
      '--json',
    ]);

    const result = recordValue(parseJsonObjectFromCliCapture(consoleOutput));
    expect(result).toMatchObject({
      workflow: 'BackfillPlan',
      payload: payloadPath,
      persisted: false,
      runRequired: true,
    });
  });

  it('points missing step modules to --mock', async () => {
    await mkdir(join(process.cwd(), 'prisma'), { recursive: true });
    const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
    await writeFile(
      schemaPath,
      `workflow MissingModule {
  trigger eventCreated {
    source = "test"
    event = "event.created"
  }

  step record {
    run = "./steps/missing.mjs"
  }
}
`,
    );

    let caught: unknown;
    try {
      await executeCommand(createWorkflowCommand(), ['test', '--schema', schemaPath]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof Error) {
      expect(caught.message).toContain('Workflow step module not found');
      expect(caught.message).toContain('--mock');
    }
  });
});
