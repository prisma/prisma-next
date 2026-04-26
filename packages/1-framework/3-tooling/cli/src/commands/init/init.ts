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
  type PackageManager,
} from './detect-package-manager';
import { detectPnpmCatalogOverrides, type PnpmCatalogOverride } from './detect-pnpm-catalog';
import { errorInitEmitFailed, errorInitInstallFailed, errorInitMissingManifest } from './errors';
import {
  INIT_EXIT_EMIT_FAILED,
  INIT_EXIT_INSTALL_FAILED,
  INIT_EXIT_OK,
  INIT_EXIT_PRECONDITION,
  INIT_EXIT_USER_ABORTED,
} from './exit-codes';
import { mergeGitattributes, requiredGitattributesLines } from './hygiene-gitattributes';
import { mergeGitignore } from './hygiene-gitignore';
import { mergePackageScripts, REQUIRED_SCRIPTS } from './hygiene-package-scripts';
import { type InitFlagOptions, type ResolvedInitInputs, resolveInitInputs } from './inputs';
import {
  buildNextSteps,
  formatInitJson,
  type InitOutput,
  InitOutputSchema,
  renderInitOutro,
} from './output';
import { agentSkillMd } from './templates/agent-skill';
import { configFile, dbFile, starterSchema, targetPackageName } from './templates/code-templates';
import { envExampleContent, envFileContent } from './templates/env';
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
  readonly warnings: readonly string[];
}

/**
 * Runs the `init` command end-to-end and returns the exit code. Catches
 * structured CLI errors raised at every phase (input resolution, install,
 * emit) and renders them via the same UI surface as success output
 * (`--json` to stdout, human to stderr). Exit codes follow the documented
 * stable set in `./exit-codes.ts` (FR1.6) and the
 * [Style Guide § Exit Codes](../../../../../../../docs/CLI%20Style%20Guide.md#exit-codes).
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
    /**
     * Whether `init` may render an interactive prompt. Decoupled from
     * `flags.interactive` (which gates `TerminalUI` decoration / stdout
     * mode) — see [Style Guide § Interactivity](../../../../../../../docs/CLI%20Style%20Guide.md#interactivity).
     */
    readonly canPrompt: boolean;
  },
): Promise<number> {
  const { options, flags, canPrompt } = runOptions;
  const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });
  const warnings: string[] = [];
  const filesWritten: string[] = [];

  if (!flags.json && !flags.quiet) {
    clack.intro('prisma-next init', { output: process.stderr });
  }

  if (!hasProjectManifest(baseDir)) {
    return emitError(ui, flags, errorInitMissingManifest());
  }

  let inputs: ResolvedInitInputs;
  try {
    inputs = await resolveInitInputs({ baseDir, options, flags, canPrompt });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return emitError(ui, flags, error);
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
    { path: '.env.example', content: envExampleContent(inputs.target) },
  ];

  for (const file of files) {
    const fullPath = join(baseDir, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
    filesWritten.push(file.path);
  }

  // FR3.2: write a real `.env` only when the user opted in via flag or
  // interactive prompt. We never overwrite an existing `.env` — secrets
  // already live there and clobbering them is the most damaging
  // possible side-effect of `init`. Touching `.env.example` is fine
  // because it's documented to be regenerated.
  if (inputs.writeEnv) {
    const envPath = join(baseDir, '.env');
    if (!existsSync(envPath)) {
      writeFileSync(envPath, envFileContent(inputs.target), 'utf-8');
      filesWritten.push('.env');
    } else {
      warnings.push(
        '.env already exists; leaving it untouched. Compare with .env.example for any new keys.',
      );
    }
  }

  // FR2.2: tsconfig.json gets the minimum compiler options the
  // scaffolded files need (notably `types: ["node"]` so `process.env`
  // resolves under `moduleResolution: "bundler"`).
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

  // FR3.3: idempotent .gitignore — append only what's missing.
  const gitignorePath = join(baseDir, '.gitignore');
  const existingGitignore = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf-8')
    : undefined;
  const newGitignore = mergeGitignore(existingGitignore);
  if (newGitignore !== null) {
    writeFileSync(gitignorePath, newGitignore, 'utf-8');
    filesWritten.push('.gitignore');
  }

  // FR3.4: idempotent .gitattributes — append linguist-generated lines
  // for the artefacts emitted into `schemaDir` so GitHub diff stats and
  // code review collapse the generated files by default.
  const gitattributesPath = join(baseDir, '.gitattributes');
  const existingGitattributes = existsSync(gitattributesPath)
    ? readFileSync(gitattributesPath, 'utf-8')
    : undefined;
  const newGitattributes = mergeGitattributes(
    existingGitattributes,
    requiredGitattributesLines(schemaDir, inputs.target),
  );
  if (newGitattributes !== null) {
    writeFileSync(gitattributesPath, newGitattributes, 'utf-8');
    filesWritten.push('.gitattributes');
  }

  // FR3.5: idempotent package.json#scripts updater. Collisions with a
  // user-written script of the same name produce a structured warning
  // and the user's script is preserved.
  const packageJsonPath = join(baseDir, 'package.json');
  if (existsSync(packageJsonPath)) {
    const pkgRaw = readFileSync(packageJsonPath, 'utf-8');
    const { content: nextPkg, warnings: scriptWarnings } = mergePackageScripts(
      pkgRaw,
      REQUIRED_SCRIPTS,
    );
    if (nextPkg !== null) {
      writeFileSync(packageJsonPath, nextPkg, 'utf-8');
      filesWritten.push('package.json');
    }
    warnings.push(...scriptWarnings);
  }

  const emitCommand = formatRunCommand(pm, 'prisma-next', 'contract emit');

  let install: InstallReport;
  try {
    install = await runInstall({
      baseDir,
      pm,
      target: inputs.target,
      install: inputs.install,
      flags,
      ui,
      filesWritten,
    });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return emitError(ui, flags, error);
    }
    throw error;
  }
  warnings.push(...install.warnings);

  let contractEmitted = false;
  if (!install.skipped) {
    try {
      await runEmit({ baseDir, ui, filesWritten, emitCommand });
      contractEmitted = true;
    } catch (error) {
      if (CliStructuredError.is(error)) {
        return emitError(ui, flags, error);
      }
      throw error;
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

  // Validate the success document at the boundary so a regression in any
  // upstream branch (templates, schema, install report) shows up as a
  // typed runtime failure here instead of an opaque consumer-side parse
  // error. The schema is also exported on the package surface for
  // downstream consumers.
  const validated = InitOutputSchema(output);
  if (validated instanceof Error || (validated as { problems?: unknown }).problems !== undefined) {
    throw new CliStructuredError('5009', 'Init produced an invalid output document', {
      domain: 'CLI',
      why: `The success document failed schema validation: ${String(validated)}`,
      fix: 'This is a bug in prisma-next. Please report it with the full `-v` output.',
      docsUrl: 'https://prisma-next.dev/docs/cli/init',
    });
  }

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
 * code derived from the error's PN code. JSON-mode errors go to stdout
 * (so consumers always parse from one place); human-mode errors go to
 * stderr. Mirrors `handleResult` but returns init-specific exit codes
 * rather than the CLI/RUN binary.
 */
function emitError(ui: TerminalUI, flags: GlobalFlags, error: CliStructuredError): number {
  const envelope = error.toEnvelope();
  if (flags.json) {
    ui.output(formatErrorJson(envelope));
  } else {
    ui.error(formatErrorOutput(envelope, flags));
  }
  return exitCodeForError(error);
}

/**
 * Maps a structured init error to its documented exit code. Centralised so
 * a missing case here surfaces as a TypeScript error (via the exhaustive
 * default) rather than as a silent `INTERNAL_ERROR` fallback.
 *
 * See [exit-codes.ts](./exit-codes.ts) for the canonical list and
 * [Style Guide § Exit Codes](../../../../../../../docs/CLI%20Style%20Guide.md#exit-codes)
 * for the reservation policy.
 */
function exitCodeForError(error: CliStructuredError): number {
  switch (error.code) {
    case '5001': // missing manifest — precondition
    case '5002': // re-init needs --force — precondition
    case '5003': // missing flags — precondition
    case '5004': // invalid flag value — precondition
    case '5005': // --strict-probe without --probe-db — precondition
      return INIT_EXIT_PRECONDITION;
    case '5006': // user aborted interactive prompt
      return INIT_EXIT_USER_ABORTED;
    case '5007': // install failed
      return INIT_EXIT_INSTALL_FAILED;
    case '5008': // emit failed
      return INIT_EXIT_EMIT_FAILED;
    default:
      return INIT_EXIT_PRECONDITION;
  }
}

/**
 * Drives the `pnpm add` / `npm install` step. Failures are escalated to
 * a structured `errorInitInstallFailed` (exit code 4) — the spec treats
 * an unrecoverable install as a hard outcome rather than a warning so
 * CI/agents can branch on the exit code (FR1.6).
 *
 * For pnpm specifically, we additionally implement the FR7.2 fallback:
 * if pnpm fails with a recognised workspace/catalog resolution error
 * class (typically caused by a registry version that leaked
 * `workspace:*` or `catalog:` specifiers), we retry the install using
 * `npm` and surface a non-fatal warning explaining the swap.
 */
async function runInstall(ctx: {
  readonly baseDir: string;
  readonly pm: Awaited<ReturnType<typeof detectPackageManager>>;
  readonly target: ResolvedInitInputs['target'];
  readonly install: boolean;
  readonly flags: GlobalFlags;
  readonly ui: TerminalUI;
  readonly filesWritten: readonly string[];
}): Promise<InstallReport> {
  const { baseDir, pm, target, install, flags, ui, filesWritten } = ctx;
  const pkg = targetPackageName(target);
  const deps = [pkg, 'dotenv'];
  // FR2.1: `@types/node` is unconditional — under
  // `moduleResolution: 'bundler'` (FR2.2) the scaffolded `db.ts` /
  // `prisma-next.config.ts` reference `process.env`, which only
  // typechecks with Node's ambient types in the resolution graph. We
  // pin it as a devDep rather than relying on a transitive resolution
  // through `dotenv` because `dotenv`'s own types bundle is internal
  // and not guaranteed across versions. Listed last so the install log
  // still leads with the user-relevant `prisma-next` line.
  const devDeps = ['prisma-next', '@types/node'];

  const addCommand = `${pm} ${formatAddArgs(pm, deps).join(' ')}`;
  const addDevCommand = `${pm} ${formatAddDevArgs(pm, devDeps).join(' ')}`;
  const emitCommand = formatRunCommand(pm, 'prisma-next', 'contract emit');

  // FR7.3 / Spec Decision 8 — honour-and-warn: if the surrounding pnpm
  // workspace pins one of our packages via the catalog, surface a
  // structured warning so the user knows the catalog version (not the
  // published `latest`) is what ends up installed. We collect the
  // warning whether or not we actually run install — the override
  // applies to a manual install too — but only when pnpm is the chosen
  // PM (catalog: specifiers are pnpm-specific).
  const catalogWarnings = pm === 'pnpm' ? buildCatalogWarnings(baseDir, [...deps, ...devDeps]) : [];

  if (!install) {
    if (!flags.json && !flags.quiet) {
      ui.note(
        [
          'Run the following commands to complete setup:',
          '',
          '  1. Install dependencies:',
          `     ${addCommand}`,
          `     ${addDevCommand}`,
          '',
          '  2. Emit the contract:',
          `     ${emitCommand}`,
        ].join('\n'),
        'Manual steps',
      );
    }
    return { skipped: true, deps: [], devDeps: [], warnings: catalogWarnings };
  }

  const exec = promisify(execFile);
  const runPair = async (manager: PackageManager): Promise<void> => {
    await exec(manager, formatAddArgs(manager, deps), { cwd: baseDir });
    await exec(manager, formatAddDevArgs(manager, devDeps), { cwd: baseDir });
  };

  const allPackages = [...deps, ...devDeps].join(', ');
  const spinner = ui.spinner();
  spinner.start(`Installing ${allPackages}...`);
  try {
    await runPair(pm);
    spinner.stop(`Installed ${allPackages}`);
    return { skipped: false, deps, devDeps, warnings: catalogWarnings };
  } catch (err) {
    const stderrText = redactSecrets(readChildStderr(err));

    // FR7.2: detect a recognised pnpm workspace/catalog resolution error
    // and fall back to npm. Limited to pnpm specifically; npm/yarn/bun/deno
    // failures escalate straight to a structured install error.
    if (pm === 'pnpm' && isRecognisedPnpmResolutionError(stderrText)) {
      spinner.message(
        'pnpm could not resolve a workspace/catalog dependency, retrying with npm...',
      );
      try {
        await runPair('npm');
        spinner.stop(`Installed ${allPackages} via npm (pnpm fallback)`);
        const fallbackWarning = [
          'pnpm could not install: a published Prisma Next dependency leaked a `workspace:*` or `catalog:` specifier.',
          'Falling back to `npm install` so init can complete.',
          stderrText ? `  pnpm error: ${stderrText.trim().split('\n')[0]}` : '',
          'Once the offending package republishes a clean version, re-run `pnpm install` to switch back.',
        ]
          .filter(Boolean)
          .join('\n');
        return {
          skipped: false,
          deps,
          devDeps,
          // The pnpm fallback fired, so the workspace catalog is not the
          // version that was actually installed (npm bypassed pnpm's
          // resolver). Surface the fallback warning but suppress the
          // catalog-honour warning to avoid a contradictory message
          // pair.
          warnings: [fallbackWarning],
        };
      } catch (npmErr) {
        spinner.stop('Installation failed');
        const npmStderr = redactSecrets(readChildStderr(npmErr));
        throw errorInitInstallFailed({
          addCommand,
          addDevCommand,
          emitCommand,
          filesWritten,
          stderrLines: [stderrText, npmStderr],
        });
      }
    }

    spinner.stop('Installation failed');
    throw errorInitInstallFailed({
      addCommand,
      addDevCommand,
      emitCommand,
      filesWritten,
      stderrLines: [stderrText],
    });
  }
}

/**
 * Builds the FR7.3 catalog-honoured warning(s) for the surrounding pnpm
 * workspace, if any. Returns an empty array when no `pnpm-workspace.yaml`
 * exists in any ancestor or when the workspace's catalog has no entry
 * for any of the packages `init` is about to install.
 *
 * Exported for unit tests.
 */
export function buildCatalogWarnings(
  baseDir: string,
  packages: readonly string[],
): readonly string[] {
  const result = detectPnpmCatalogOverrides(baseDir, packages);
  if (result === null || result.entries.length === 0) {
    return [];
  }
  return [formatCatalogWarning(result.workspaceFile, result.entries)];
}

function formatCatalogWarning(
  workspaceFile: string,
  entries: readonly PnpmCatalogOverride[],
): string {
  const list = entries.map((entry) => `  • ${entry.name}: ${entry.version}`).join('\n');
  return [
    'pnpm workspace catalog overrides detected — pnpm will install these versions instead of `latest`:',
    list,
    `Catalog source: ${workspaceFile}`,
    'To use the published `latest` instead, remove or update the catalog entry, then re-run `pnpm install`.',
  ].join('\n');
}

/**
 * Recognised pnpm error signatures that justify a fallback to npm.
 *
 * These patterns indicate the published artefact itself is at fault
 * (a leaked `workspace:*` or `catalog:` specifier), not the user's
 * environment — pnpm is faithfully reporting "I cannot resolve this
 * registry version", and npm is willing to install it because npm
 * doesn't care about the protocol prefix when there's a fallback range.
 *
 * Exported for unit tests; do not depend on this from outside the init
 * command.
 */
export function isRecognisedPnpmResolutionError(stderr: string): boolean {
  if (!stderr) return false;
  return (
    stderr.includes('ERR_PNPM_WORKSPACE_PKG_NOT_FOUND') ||
    stderr.includes('ERR_PNPM_NO_MATCHING_VERSION') ||
    /No matching version found for .* in the catalog/i.test(stderr) ||
    /workspace:[^\s]+ is not a valid (version|spec)/i.test(stderr) ||
    /catalog:[^\s]* is not a valid (version|spec)/i.test(stderr)
  );
}

function readChildStderr(err: unknown): string {
  if (err instanceof Error && 'stderr' in err) {
    return String((err as { stderr: string }).stderr ?? '');
  }
  return '';
}

/**
 * Redacts userinfo (`user:password@`) from any URL-shaped substring inside
 * package-manager stderr before we surface it in a warning or error
 * meta. pnpm and npm both include the offending registry URL in resolve
 * errors, and that URL can carry an auth token (e.g. corporate registry
 * mirrors that bake `_authToken` into the URL). The Style Guide
 * (Testing & Accessibility — "Security: never print secrets") requires
 * we never surface those.
 *
 * Exported for unit tests.
 */
export function redactSecrets(stderr: string): string {
  if (!stderr) return stderr;
  // Match `scheme://userinfo@host…` and replace the userinfo with `***`.
  return stderr.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+)@/g, '$1***@');
}

/**
 * Drives `prisma-next contract emit` against the freshly scaffolded
 * project. On failure, throws `errorInitEmitFailed` with the underlying
 * cause embedded in `meta.cause` so the user can re-run with `-v` to see
 * the full envelope and follow the fix steps. Maps to exit code
 * `5 = EMIT_FAILED` (FR1.6).
 */
async function runEmit(ctx: {
  readonly baseDir: string;
  readonly ui: TerminalUI;
  readonly filesWritten: readonly string[];
  readonly emitCommand: string;
}): Promise<void> {
  const spinner = ctx.ui.spinner();
  spinner.start('Emitting contract...');
  try {
    const { executeContractEmit } = await import('../../control-api/operations/contract-emit');
    const configFilePath = join(ctx.baseDir, 'prisma-next.config.ts');
    await executeContractEmit({ configPath: configFilePath });
    spinner.stop('Contract emitted');
  } catch (err) {
    spinner.stop('Contract emission failed');
    throw errorInitEmitFailed({
      emitCommand: ctx.emitCommand,
      filesWritten: ctx.filesWritten,
      cause: causeMessage(err),
    });
  }
}

function causeMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
