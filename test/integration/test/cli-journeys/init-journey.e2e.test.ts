/**
 * `prisma-next init` user-journey test (TML-2490) — seam verifier.
 *
 * Walks the full user inner loop from `prisma-next init` through to a working
 * query against a real DB, across all four `(target × authoring)` cells.
 * Asserts the contract one subsystem hands to the next at every seam.
 *
 * See `projects/init-journey-tests/spec.md` for the design and the four
 * currently-broken seams this test will end up encoding:
 * TML-2486, TML-2487, TML-2314, TML-2461.
 *
 * Phase A scope: step 1 only — `prisma-next init` materialises the expected
 * scaffold. Subsequent phases extend the journey toward `db init` + user
 * code + migration round-trip.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_CELLS,
  type CellId,
  type CommandRun,
  cellLabel,
  createJourneyProject,
  type JourneyProject,
} from './init-journey/harness';

describe.each(
  ALL_CELLS.map((cell) => ({ cell, label: cellLabel(cell) })),
)('init-journey · $label', ({ cell }) => {
  let project: JourneyProject;

  beforeAll(async () => {
    project = await createJourneyProject(cell);
  }, 240_000);

  afterAll(() => {
    project?.cleanup();
  });

  it('step 1 (init): scaffolds the expected project skeleton', () => {
    expect(project.initResult.exitCode, formatInitDiagnostic(project)).toBe(0);

    expectScaffoldedFiles(project);
    expectSchemaFile(project, cell);
    expectConfigFile(project, cell);
  });

  it('step 2 (install): pnpm install succeeds with isolated linker', () => {
    const install = project.installResult;
    expect(install, 'install was skipped — harness option mismatch').not.toBeNull();
    if (install === null) return;
    expect(install.exitCode, formatInstallDiagnostic(project, install)).toBe(0);

    expectFacadeIsResolvable(project);
  });
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

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
