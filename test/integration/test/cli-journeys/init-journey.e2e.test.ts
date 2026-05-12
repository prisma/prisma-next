/**
 * `prisma-next init` user-journey test (TML-2490) — seam verifier.
 *
 * Walks the full user inner loop from `prisma-next init` through to a working
 * query against a real DB, across all four `(target × authoring)` cells.
 * Asserts the contract one subsystem hands to the next at every seam.
 *
 * Initial state: this file lands "red-by-design". Each known seam bug
 * (TML-2461, TML-2486, TML-2487, TML-2314) is encoded as a `seamExpectation`
 * with `status: 'broken'`, so the test passes precisely *because* the bug
 * is still present. Each subsequent bug-fix commit in this PR flips one
 * status from `'broken'` to `'fixed'` alongside the implementation change,
 * proving the seam was the thing the test was actually watching.
 *
 * See `projects/init-journey-tests/spec.md` for the design.
 */

import { existsSync, readFileSync } from 'node:fs';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DatabaseHandle, spinUpDatabaseForCell } from './init-journey/database-handles';
import {
  ALL_CELLS,
  attachDatabase,
  type CellId,
  type CommandRun,
  cellLabel,
  createJourneyProject,
  dbInit,
  emitContract,
  type JourneyProject,
  runUserCode,
  type StepResult,
  seamExpectation,
} from './init-journey/harness';

/** Per-cell journey runtime artefacts, populated once in `beforeAll`. */
interface JourneyContext {
  readonly project: JourneyProject;
  readonly database: DatabaseHandle | null;
  readonly emit: StepResult | null;
  readonly dbInit: StepResult | null;
}

describe.each(
  ALL_CELLS.map((cell) => ({ cell, label: cellLabel(cell) })),
)('init-journey · $label', ({ cell }) => {
  let ctx: JourneyContext;

  beforeAll(async () => {
    ctx = await runFullJourney(cell);
  }, 240_000);

  afterAll(async () => {
    await ctx?.database?.close();
    ctx?.project?.cleanup();
  });

  it('step 1 (init): scaffolds the expected project skeleton', () => {
    expect(ctx.project.initResult.exitCode, formatInitDiagnostic(ctx.project)).toBe(0);

    expectScaffoldedFiles(ctx.project);
    expectSchemaFile(ctx.project, cell);
    expectConfigFile(ctx.project, cell);
  });

  it('step 2 (install): pnpm install succeeds with isolated linker', () => {
    const install = ctx.project.installResult;
    expect(install, 'install was skipped — harness option mismatch').not.toBeNull();
    if (install === null) return;
    expect(install.exitCode, formatInstallDiagnostic(ctx.project, install)).toBe(0);

    expectFacadeIsResolvable(ctx.project);
  });

  it('step 3 (emit): produces contract.json + contract.d.ts next to the input', () => {
    const emit = ctx.emit;
    expect(emit, 'emit was not run (precondition failure)').not.toBeNull();
    if (emit === null) return;
    expect(emit.exitCode, formatStepDiagnostic('emit', ctx.project, emit)).toBe(0);

    // The init scaffold passes a single string `contract: "./prisma/contract.ts"`
    // to the facade `defineConfig`, which derives an output path next to the
    // input. The journey verifies that derivation actually reaches the emitter
    // — this is the seam that breaks when init scaffold and emit output get
    // out of sync (the symptom shape of TML-2461, even if the facade currently
    // masks the underlying default-output bug).
    expect(
      existsSync(join(ctx.project.dir, 'prisma/contract.json')),
      'contract.json must land next to the scaffolded contract source',
    ).toBe(true);
    expect(
      existsSync(join(ctx.project.dir, 'prisma/contract.d.ts')),
      'contract.d.ts must land next to the scaffolded contract source',
    ).toBe(true);
  });

  it('step 4 (db init): provisions the schema (TML-2486 seam)', () => {
    const result = ctx.dbInit;
    expect(result, 'db init was not run (precondition failure)').not.toBeNull();
    if (result === null) return;
    TML_2486_seam(cell, ctx.project, result);
  });

  it(
    'step 5 (user code: ObjectId import) (TML-2487 seam)',
    async () => {
      if (cell.target !== 'mongo') return;
      const run = await runUserCode(
        ctx.project,
        'check-objectid.ts',
        [
          "import { ObjectId } from '@prisma-next/mongo';",
          'const id = new ObjectId();',
          'console.log(id.toHexString().length);',
          '',
        ].join('\n'),
      );
      TML_2487_seam(run);
    },
    timeouts.coldTransformImport,
  );

  it(
    'step 6 (user code: control readMarker query) (TML-2314 seam)',
    async () => {
      if (cell.target !== 'postgres') return;
      // Real end-to-end control-plane query: the user instantiates the
      // facade-composed client, connects to the live DB (DATABASE_URL is
      // injected via `--env-file-if-exists=.env` in the subprocess) and
      // reads the contract marker that step 4's `db init` wrote. This
      // proves the facade composes a working family + target + adapter +
      // driver stack and round-trips a real query, not just that the
      // export is importable.
      const run = await runUserCode(
        ctx.project,
        'check-control.ts',
        [
          "import { createPostgresControlClient } from '@prisma-next/postgres/control';",
          '',
          'const url = process.env.DATABASE_URL;',
          'if (url === undefined) {',
          "  console.error('DATABASE_URL missing');",
          '  process.exit(2);',
          '}',
          '',
          'const client = createPostgresControlClient({ connection: url });',
          'await client.connect();',
          'try {',
          '  const marker = await client.readMarker();',
          "  console.log(marker !== null ? 'ok' : 'no-marker');",
          '} finally {',
          '  await client.close();',
          '}',
          '',
        ].join('\n'),
      );
      TML_2314_seam(run);
    },
    timeouts.coldTransformImport,
  );
});

async function runFullJourney(cell: CellId): Promise<JourneyContext> {
  const project = await createJourneyProject(cell);
  if (project.initResult.exitCode !== 0 || project.installResult?.exitCode !== 0) {
    return { project, database: null, emit: null, dbInit: null };
  }

  const database = await spinUpDatabaseForCell(cell);
  attachDatabase(project, database.connectionString);

  const emit = await emitContract(project);
  const dbInitResult = await dbInit(project);

  return { project, database, emit, dbInit: dbInitResult };
}

// --- Seam expectations -----------------------------------------------------
//
// One per known seam bug. Each is a `seamExpectation<T>` with `status:
// 'broken'`. When the matching fix commit lands, the maintainer flips
// `'broken'` to `'fixed'` here and the assertion follows.

const TML_2486_seam = (cell: CellId, project: JourneyProject, result: StepResult): void => {
  if (cell.target !== 'mongo') {
    expect(result.exitCode, formatStepDiagnostic('db init', project, result)).toBe(0);
    return;
  }
  seamExpectation<StepResult>({
    ticket: 'TML-2486',
    description: 'mongo db init successfully creates the contract collections',
    status: 'fixed',
    whenBroken: (r) => {
      expect(r.exitCode, 'TML-2486 still broken: mongo db init must currently fail').not.toBe(0);
      const combined = `${r.stdout}\n${r.stderr}`;
      expect(
        combined,
        'TML-2486 still broken: mongo error must mention undefined fields or missing collections',
      ).toMatch(/undefined|PN-CLI-4999|createCollection|PN-RUN-3020|missing_table/);
    },
    whenFixed: (r) => {
      expect(r.exitCode, formatStepDiagnostic('db init', project, r)).toBe(0);
    },
  })(result);
};

const TML_2487_seam = seamExpectation<StepResult>({
  ticket: 'TML-2487',
  description: '@prisma-next/mongo re-exports ObjectId',
  status: 'fixed',
  whenBroken: (r) => {
    expect(r.exitCode, 'TML-2487 still broken: ObjectId import must currently fail').not.toBe(0);
  },
  whenFixed: (r) => {
    expect(r.exitCode, formatStepDiagnostic('ObjectId import', null, r)).toBe(0);
    expect(r.stdout.trim(), 'ObjectId.toHexString() should yield 24 hex chars').toBe('24');
  },
});

const TML_2314_seam = seamExpectation<StepResult>({
  ticket: 'TML-2314',
  description: '@prisma-next/postgres/control composes a working control stack',
  status: 'fixed',
  whenBroken: (r) => {
    expect(r.exitCode, 'TML-2314 still broken: control import must currently fail').not.toBe(0);
  },
  whenFixed: (r) => {
    expect(r.exitCode, formatStepDiagnostic('control readMarker', null, r)).toBe(0);
    expect(
      r.stdout.trim(),
      'control client must connect and read the marker written by db init',
    ).toBe('ok');
  },
});

function expectScaffoldedFiles(project: JourneyProject): void {
  const required = [
    'package.json',
    'prisma-next.config.ts',
    schemaPath(project.cell),
    'prisma/db.ts',
    'tsconfig.json',
  ];
  for (const rel of required) {
    expect(existsSync(join(project.dir, rel)), `expected scaffold to include ${rel}`).toBe(true);
  }
}

function expectSchemaFile(project: JourneyProject, cell: CellId): void {
  const contents = readFileSync(join(project.dir, schemaPath(cell)), 'utf-8');

  if (cell.authoring === 'typescript') {
    expect(contents, 'TS schema imports defineContract from the facade').toContain(
      `from '@prisma-next/${cell.target}/contract-builder'`,
    );
    expect(contents, 'TS schema imports family from the facade').toContain(
      `from '@prisma-next/${cell.target}/family'`,
    );
    expect(contents, 'TS schema imports target from the facade').toContain(
      `from '@prisma-next/${cell.target}/target'`,
    );
  } else {
    expect(contents, 'PSL schema declares at least one model').toMatch(/^model\s+\w+\s*\{/m);
    if (cell.target === 'mongo') {
      expect(contents, 'Mongo PSL uses ObjectId for ids').toContain('ObjectId');
    }
  }
}

function expectConfigFile(project: JourneyProject, cell: CellId): void {
  const contents = readFileSync(join(project.dir, 'prisma-next.config.ts'), 'utf-8');
  expect(contents, 'config imports postgres/mongo facade only').toContain(
    `from '@prisma-next/${cell.target}/config'`,
  );
  expect(contents, 'config references the schema file').toContain(schemaPath(cell));
}

function schemaPath(cell: CellId): string {
  return cell.authoring === 'typescript' ? 'prisma/contract.ts' : 'prisma/contract.prisma';
}

function expectFacadeIsResolvable(project: JourneyProject): void {
  const facadeName =
    project.cell.target === 'mongo' ? '@prisma-next/mongo' : '@prisma-next/postgres';
  const facadePath = join(project.dir, 'node_modules', facadeName, 'package.json');
  expect(existsSync(facadePath), `facade package not installed at ${facadePath}`).toBe(true);
}

function formatInitDiagnostic(project: JourneyProject): string {
  return [
    `prisma-next init failed for ${cellLabel(project.cell)}`,
    `  exit code: ${project.initResult.exitCode}`,
    '  stdout:',
    indent(project.initResult.stdout, '    '),
    '  stderr:',
    indent(project.initResult.stderr, '    '),
  ].join('\n');
}

function formatInstallDiagnostic(project: JourneyProject, install: CommandRun): string {
  return [
    `pnpm install failed for ${cellLabel(project.cell)}`,
    `  exit code: ${install.exitCode}`,
    `  cwd: ${project.dir}`,
    '  stdout:',
    indent(install.stdout, '    '),
    '  stderr:',
    indent(install.stderr, '    '),
  ].join('\n');
}

function formatStepDiagnostic(
  step: string,
  project: JourneyProject | null,
  result: StepResult,
): string {
  return [
    `${step} failed${project !== null ? ` for ${cellLabel(project.cell)}` : ''}`,
    `  command: ${result.command}`,
    `  exit code: ${result.exitCode}`,
    ...(project !== null ? [`  cwd: ${project.dir}`] : []),
    '  stdout:',
    indent(result.stdout, '    '),
    '  stderr:',
    indent(result.stderr, '    '),
  ].join('\n');
}

function indent(text: string | undefined, prefix: string): string {
  if (text === undefined || text.length === 0) return `${prefix}<empty>`;
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
