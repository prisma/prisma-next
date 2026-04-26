import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import * as clack from '@clack/prompts';
import { dirname, isAbsolute, join } from 'pathe';
import { CliStructuredError } from '../../utils/cli-errors';
import { formatErrorJson, formatErrorOutput } from '../../utils/formatters/errors';
import type { GlobalFlags } from '../../utils/global-flags';
import { TerminalUI } from '../../utils/terminal-ui';
import {
  detectPackageManager,
  formatAddArgs,
  formatAddDevArgs,
  formatRunCommand,
  hasProjectManifest,
} from './detect-package-manager';
import { errorInitMissingManifest } from './errors';
import { INIT_EXIT_OK, INIT_EXIT_PRECONDITION, INIT_EXIT_USER_ABORTED } from './exit-codes';
import { type InitFlagOptions, type ResolvedInitInputs, resolveInitInputs } from './inputs';
import { buildNextSteps, formatInitJson, type InitOutput, renderInitOutro } from './output';
import { agentSkillMd } from './templates/agent-skill';
import { configFile, dbFile, starterSchema, targetPackageName } from './templates/code-templates';
import { quickReferenceMd } from './templates/quick-reference';
import { defaultTsConfig, mergeTsConfig } from './templates/tsconfig';

interface FileEntry {
  readonly path: string;
  readonly content: string;
}

interface InstallReport {
  readonly skipped: boolean;
  readonly deps: readonly string[];
  readonly devDeps: readonly string[];
  readonly succeeded: boolean;
  readonly warning?: string;
}

/**
 * Runs the `init` command end-to-end and returns the exit code. Catches
 * structured CLI errors raised by input resolution and renders them via
 * the same UI surface as success output (`--json` to stdout, human to
 * stderr). Exit codes follow the documented stable set in
 * `./exit-codes.ts` (FR1.6).
 *
 * Layered for testability: the action handler in `./index.ts` is
 * responsible for parsing flags and constructing `runOptions`; this
 * function does no flag parsing of its own.
 */
export async function runInit(
  baseDir: string,
  runOptions: {
    readonly options: InitFlagOptions;
    readonly flags: GlobalFlags;
  },
): Promise<number> {
  const { options, flags } = runOptions;
  const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });
  const warnings: string[] = [];

  if (!flags.json && !flags.quiet) {
    clack.intro('prisma-next init', { output: process.stderr });
  }

  if (!hasProjectManifest(baseDir)) {
    return emitError(ui, flags, errorInitMissingManifest(), INIT_EXIT_PRECONDITION);
  }

  let inputs: ResolvedInitInputs;
  try {
    inputs = await resolveInitInputs({ baseDir, options, flags });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      // `5006` is the dedicated "user aborted an interactive prompt" code;
      // every other error from input resolution is a precondition failure.
      const exitCode = error.code === '5006' ? INIT_EXIT_USER_ABORTED : INIT_EXIT_PRECONDITION;
      return emitError(ui, flags, error, exitCode);
    }
    throw error;
  }

  const pm = await detectPackageManager(baseDir);
  const pkgRun = formatRunCommand(pm, 'prisma-next', '').trimEnd();

  const schemaDir = dirname(inputs.schemaPath);
  const configContractPath = isAbsolute(inputs.schemaPath)
    ? inputs.schemaPath
    : `./${inputs.schemaPath}`;

  const files: FileEntry[] = [
    { path: inputs.schemaPath, content: starterSchema(inputs.target, inputs.authoring) },
    {
      path: 'prisma-next.config.ts',
      content: configFile(inputs.target, configContractPath),
    },
    { path: join(schemaDir, 'db.ts'), content: dbFile(inputs.target) },
    {
      path: 'prisma-next.md',
      content: quickReferenceMd(inputs.target, inputs.schemaPath, pkgRun),
    },
    {
      path: '.agents/skills/prisma-next/SKILL.md',
      content: agentSkillMd(inputs.target, inputs.schemaPath, pkgRun),
    },
  ];

  const filesWritten: string[] = [];
  for (const file of files) {
    const fullPath = join(baseDir, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
    filesWritten.push(file.path);
  }

  const tsconfigPath = join(baseDir, 'tsconfig.json');
  const tsconfigRel = 'tsconfig.json';
  if (existsSync(tsconfigPath)) {
    const existing = readFileSync(tsconfigPath, 'utf-8');
    writeFileSync(tsconfigPath, mergeTsConfig(existing), 'utf-8');
    if (!flags.json && !flags.quiet) {
      ui.log('Updated tsconfig.json with required compiler options.');
    }
    filesWritten.push(tsconfigRel);
  } else {
    writeFileSync(tsconfigPath, defaultTsConfig(), 'utf-8');
    filesWritten.push(tsconfigRel);
  }

  const emitCommand = formatRunCommand(pm, 'prisma-next', 'contract emit');
  const install = await runInstall({
    baseDir,
    pm,
    target: inputs.target,
    install: inputs.install,
    flags,
    ui,
  });
  if (install.warning !== undefined) {
    warnings.push(install.warning);
  }

  let contractEmitted = false;
  if (install.succeeded && !install.skipped) {
    contractEmitted = await runEmit({ baseDir, ui, flags });
    if (!contractEmitted) {
      warnings.push(
        `Contract emission failed. Run manually: \`${emitCommand}\` once your environment is ready.`,
      );
    }
  }

  const output: InitOutput = {
    ok: true,
    target: inputs.target === 'mongo' ? 'mongodb' : 'postgres',
    authoring: inputs.authoring,
    schemaPath: inputs.schemaPath,
    filesWritten,
    packagesInstalled: {
      skipped: install.skipped,
      deps: [...install.deps],
      devDeps: [...install.devDeps],
    },
    contractEmitted,
    nextSteps: buildNextSteps({
      target: inputs.target === 'mongo' ? 'mongodb' : 'postgres',
      contractEmitted,
      emitCommand,
      schemaPath: inputs.schemaPath,
    }),
    warnings,
  };

  if (flags.json) {
    ui.output(formatInitJson(output));
  } else {
    renderInitOutro(ui, output, flags);
    if (!flags.quiet) {
      clack.outro('Done. Open prisma-next.md to get started.', { output: process.stderr });
    }
  }

  return INIT_EXIT_OK;
}

/**
 * Renders a structured CLI error to the right channel and returns the exit
 * code. JSON-mode errors go to stdout (so consumers always parse from one
 * place); human-mode errors go to stderr. Mirrors `handleResult` but
 * returns init-specific exit codes rather than the CLI/RUN binary.
 */
function emitError(
  ui: TerminalUI,
  flags: GlobalFlags,
  error: CliStructuredError,
  exitCode: number,
): number {
  const envelope = error.toEnvelope();
  if (flags.json) {
    ui.output(formatErrorJson(envelope));
  } else {
    ui.error(formatErrorOutput(envelope, flags));
  }
  return exitCode;
}

/**
 * Drives the `pnpm add` / `npm install` step. Failures are non-fatal in
 * the current design (we surface a manual-install warning and continue);
 * the `pnpm` → `npm` fallback is M2 and slots in here.
 */
async function runInstall(ctx: {
  readonly baseDir: string;
  readonly pm: Awaited<ReturnType<typeof detectPackageManager>>;
  readonly target: ResolvedInitInputs['target'];
  readonly install: boolean;
  readonly flags: GlobalFlags;
  readonly ui: TerminalUI;
}): Promise<InstallReport> {
  const { baseDir, pm, target, install, flags, ui } = ctx;
  const pkg = targetPackageName(target);
  const deps = [pkg, 'dotenv'];
  const devDeps = ['prisma-next'];

  if (!install) {
    if (!flags.json && !flags.quiet) {
      ui.note(
        [
          'Run the following commands to complete setup:',
          '',
          '  1. Install dependencies:',
          `     ${pm} ${formatAddArgs(pm, deps).join(' ')}`,
          `     ${pm} ${formatAddDevArgs(pm, devDeps).join(' ')}`,
          '',
          '  2. Emit the contract:',
          `     ${formatRunCommand(pm, 'prisma-next', 'contract emit')}`,
        ].join('\n'),
        'Manual steps',
      );
    }
    return { skipped: true, deps: [], devDeps: [], succeeded: false };
  }

  const exec = promisify(execFile);
  const spinner = ui.spinner();
  spinner.start(`Installing ${pkg}, dotenv, and prisma-next...`);
  try {
    await exec(pm, formatAddArgs(pm, deps), { cwd: baseDir });
    await exec(pm, formatAddDevArgs(pm, devDeps), { cwd: baseDir });
    spinner.stop(`Installed ${pkg}, dotenv, and prisma-next`);
    return { skipped: false, deps, devDeps, succeeded: true };
  } catch (err) {
    spinner.stop('Installation failed');
    const stderrText =
      err instanceof Error && 'stderr' in err ? String((err as { stderr: string }).stderr) : '';
    const warning = [
      'Could not install dependencies automatically.',
      ...(stderrText ? [`  ${stderrText.trim()}`] : []),
      '',
      'Run manually:',
      `  ${pm} ${formatAddArgs(pm, deps).join(' ')}`,
      `  ${pm} ${formatAddDevArgs(pm, devDeps).join(' ')}`,
    ].join('\n');
    return { skipped: false, deps, devDeps, succeeded: false, warning };
  }
}

async function runEmit(ctx: {
  readonly baseDir: string;
  readonly ui: TerminalUI;
  readonly flags: GlobalFlags;
}): Promise<boolean> {
  const spinner = ctx.ui.spinner();
  spinner.start('Emitting contract...');
  try {
    const { executeContractEmit } = await import('../../control-api/operations/contract-emit');
    const configFilePath = join(ctx.baseDir, 'prisma-next.config.ts');
    await executeContractEmit({ configPath: configFilePath });
    spinner.stop('Contract emitted');
    return true;
  } catch {
    spinner.stop('Contract emission failed');
    return false;
  }
}

// Re-exported so tests and callers can construct exit codes without a deep
// import. Internal exit codes are otherwise consumed only by `index.ts`.
export {
  INIT_EXIT_INTERNAL_ERROR,
  INIT_EXIT_OK,
  INIT_EXIT_PRECONDITION,
  INIT_EXIT_USER_ABORTED,
} from './exit-codes';
