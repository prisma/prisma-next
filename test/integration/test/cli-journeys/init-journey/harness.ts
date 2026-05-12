/**
 * Harness for the `prisma-next init` user-journey test (TML-2490).
 *
 * A "seam verifier" — exercises the full user inner loop from `prisma-next
 * init` through to a working query against a real DB, asserting the contract
 * at each seam between subsystems. See `projects/init-journey-tests/spec.md`
 * for the design rationale.
 *
 * This harness is deliberately separate from `journey-test-helpers.ts`. The
 * existing helpers invoke CLI commands in-process (faster, suitable for
 * lifecycle-focused journeys); this harness spawns the workspace-built CLI
 * as a real subprocess inside a fresh tmpdir so the seams it traverses are
 * the seams a real user traverses. The deliberate fidelity tax is what keeps
 * TML-2485-class bugs in the failure surface.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { join, resolve } from 'pathe';

const execFileAsync = promisify(execFile);

/**
 * Path to the workspace-built CLI binary. The integration package's
 * `pretest` hook runs `pnpm -w build`, so `dist/cli.js` exists when these
 * tests run.
 */
const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const CLI_BIN = join(WORKSPACE_ROOT, 'packages/1-framework/3-tooling/cli/dist/cli.js');

export type Target = 'postgres' | 'mongo';
export type Authoring = 'psl' | 'typescript';

export interface CellId {
  readonly target: Target;
  readonly authoring: Authoring;
}

/**
 * Every (target × authoring) cell. Mirrors the existing
 * `cli.init-facade-imports.e2e.test.ts` cell set.
 */
export const ALL_CELLS: readonly CellId[] = [
  { target: 'postgres', authoring: 'typescript' },
  { target: 'postgres', authoring: 'psl' },
  { target: 'mongo', authoring: 'typescript' },
  { target: 'mongo', authoring: 'psl' },
];

export function cellLabel(cell: CellId): string {
  return `${cell.target} × ${cell.authoring}`;
}

export interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface JourneyProject {
  /** Absolute path to the tmpdir hosting the materialised project. */
  readonly dir: string;
  /** Which cell this project represents. */
  readonly cell: CellId;
  /** Result of the `prisma-next init` invocation that materialised the project. */
  readonly initResult: CommandRun;
  /** Tear down the tmpdir (idempotent). */
  cleanup(): void;
}

interface CreateJourneyProjectOptions {
  /**
   * Skip `pnpm install` + contract emission inside `init` (i.e. `--no-install`).
   * The journey owns the install + emit phases separately so each can be asserted
   * independently. Defaults to `true`.
   */
  readonly skipInstall?: boolean;
}

/**
 * Materialises a fresh project tmpdir, writes a minimal `package.json` (init
 * requires one to attach to), and runs `prisma-next init --target <t>
 * --authoring <a> --yes` via the workspace-built CLI binary as a real
 * subprocess. Returns a handle for the caller to drive subsequent journey
 * steps and a `cleanup()` for the test's `afterEach`/`afterAll`.
 */
export async function createJourneyProject(
  cell: CellId,
  options: CreateJourneyProjectOptions = {},
): Promise<JourneyProject> {
  const { skipInstall = true } = options;

  const dir = mkdtempSync(join(tmpdir(), `pn-journey-${cell.target}-${cell.authoring}-`));
  writeMinimalPackageJson(dir);

  const target = cell.target === 'mongo' ? 'mongodb' : 'postgres';
  const args = [CLI_BIN, 'init', '--target', target, '--authoring', cell.authoring, '--yes'];
  if (skipInstall) {
    args.push('--no-install');
  }

  const initResult = await runNode(args, dir);

  return {
    dir,
    cell,
    initResult,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Minimal `package.json` that satisfies init's precondition (FR2.1 in init's spec). */
function writeMinimalPackageJson(dir: string): void {
  const pkg = {
    name: 'prisma-next-journey-fixture',
    version: '0.0.0',
    private: true,
    type: 'module',
  };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
}

/**
 * Spawns `node <args>` inside `cwd` and captures the result. The CLI uses
 * `process.exit(code)`, so a non-zero exit surfaces as an `execFile`
 * rejection — we normalise both shapes into `CommandRun`.
 */
async function runNode(args: readonly string[], cwd: string): Promise<CommandRun> {
  try {
    const { stdout, stderr } = await execFileAsync('node', args as string[], { cwd });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    const exitCode = typeof e.code === 'number' ? e.code : 1;
    return { exitCode, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' };
  }
}

/**
 * Ensures the tmpdir parent exists (e.g. on systems where `os.tmpdir()`
 * points at a path that doesn't pre-exist for the test user). Exported for
 * symmetry with the writeMinimalPackageJson helper above.
 */
export function ensureTmpdir(): void {
  mkdirSync(tmpdir(), { recursive: true });
}
