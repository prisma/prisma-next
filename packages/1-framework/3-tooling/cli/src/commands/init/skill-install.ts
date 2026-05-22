import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { join } from 'pathe';
import { version as cliVersion } from '../../../package.json' with { type: 'json' };
import type { PackageManager } from './detect-package-manager';
import { errorInitSkillInstallFailed } from './errors';

const exec = promisify(execFile);

/**
 * Default base for the GitHub-URL form `<owner>/<repo>` consumed by
 * upstream `skills add`. Each `SkillSource` joins this base with its
 * own subpath (and optional `#ref` for version-pinned clusters).
 */
export const DEFAULT_SKILL_BASE = 'prisma/prisma-next';

/**
 * One discovery scope inside the Prisma Next monorepo. The CLI emits
 * one `skills add <base>/<subpath>[#ref] --all` invocation per source
 * during `init`.
 *
 * `ref` semantics:
 * - `cli`: pin to the CLI's own package version (lockstep with the
 *   skills' SPI). Used for the version-locked usage cluster — the
 *   skills under `skills/<X>/SKILL.md`, which describe the public
 *   package API and are pinned to the version of `@prisma-next/*`
 *   currently installed in the consumer's project.
 * - `null`: no ref. The cluster is "always-latest" — the cumulative
 *   instruction set is the source of truth, and the latest revision
 *   on `main` includes bug fixes for every prior transition. Used
 *   for the upgrade and extension-author clusters.
 */
export interface SkillSource {
  readonly subpath: string;
  readonly ref: 'cli' | null;
  readonly description: string;
}

export const DEFAULT_SKILL_SOURCES: readonly SkillSource[] = [
  {
    subpath: 'skills',
    ref: 'cli',
    description: 'usage skills (version-locked to installed Prisma Next)',
  },
  {
    subpath: 'skills/upgrade',
    ref: null,
    description: 'upgrade skill (always tracks `main`)',
  },
  {
    subpath: 'skills/extension-author',
    ref: null,
    description: 'extension-author skill (always tracks `main`)',
  },
];

/**
 * Test-only escape hatch for pinning the install base to a local
 * checkout. Production runs leave this unset, so installs always use
 * `DEFAULT_SKILL_BASE`.
 *
 * When set to an absolute filesystem path (typical for tests), the
 * `#ref` fragment is dropped — local-path mode in upstream's CLI does
 * not accept refs, and the local clone has whatever content the test
 * checked into it anyway. When set to anything else (e.g. a fork name
 * `myuser/prisma-next`), the ref policy is preserved.
 */
function resolveAgentSkillBase(): string {
  const override = process.env['PRISMA_NEXT_SKILLS_BASE']?.trim();
  return override && override.length > 0 ? override : DEFAULT_SKILL_BASE;
}

function isLocalPath(base: string): boolean {
  return base.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(base);
}

/**
 * Build the `<base>/<subpath>[#ref]` URL the `skills` CLI will
 * resolve. Exported for unit tests so the per-source format can be
 * asserted without going through the full install loop.
 */
export function formatSkillSourceUrl(source: SkillSource): string {
  const base = resolveAgentSkillBase();
  const url = `${base}/${source.subpath}`;
  if (source.ref === null) return url;
  if (isLocalPath(base)) return url;
  if (source.ref === 'cli') return `${url}#v${cliVersion}`;
  return url;
}

/**
 * The skill-install command for one source, formatted for the
 * project's detected package manager. `npx`/`pnpm dlx`/`bunx` are
 * interchangeable to the user; we pick the variant that matches the
 * rest of the install step so a single project consistently uses one
 * runner.
 *
 * `--all` auto-selects every skill in the cluster and every detected
 * agent runtime, skipping the multi-select prompts the `skills` CLI
 * shows by default. A non-interactive scaffold step cannot present
 * prompts.
 *
 * Exported for unit tests so the per-PM dispatch can be asserted
 * without a live subprocess.
 */
export function formatSkillInstallCommand(pm: PackageManager, source: SkillSource): string {
  const args = ['skills@latest', 'add', formatSkillSourceUrl(source), '--all'];
  return formatPackageManagerCommand(pm, args);
}

/**
 * `skills add --all` should cover Claude Code, but upstream currently skips
 * project-local Claude symlinks when `.claude/` does not already exist. Run
 * the explicit Claude Code install as well so fresh projects get
 * `.claude/skills` without asking users to create that folder first.
 */
export function formatClaudeSkillInstallCommand(pm: PackageManager, source: SkillSource): string {
  const args = [
    'skills@latest',
    'add',
    formatSkillSourceUrl(source),
    '--agent',
    'claude-code',
    '--skill',
    "'*'",
    '-y',
  ];
  return formatPackageManagerCommand(pm, args);
}

/**
 * `skills add --all` should cover Windsurf, but upstream skips project-local
 * Windsurf symlinks when `.windsurf/` does not already exist. Run the explicit
 * Windsurf install when a Windsurf session or install is detected so skills land
 * under `.windsurf/skills/` without asking users to create that folder first.
 */
export function formatWindsurfSkillInstallCommand(pm: PackageManager, source: SkillSource): string {
  const args = [
    'skills@latest',
    'add',
    formatSkillSourceUrl(source),
    '--agent',
    'windsurf',
    '--skill',
    "'*'",
    '-y',
  ];
  return formatPackageManagerCommand(pm, args);
}

function isTruthyEnvMarker(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  if (normalised === '' || normalised === '0' || normalised === 'false') return false;
  return true;
}

/**
 * Best-effort Windsurf detection for project-level skill install. Matches the
 * upstream `skills` CLI's Windsurf install probe and the `WINDSURF` session
 * marker used elsewhere in the CLI toolchain.
 */
export function isWindsurfDetected(ctx: {
  readonly baseDir: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}): boolean {
  const env = ctx.env ?? process.env;
  if (isTruthyEnvMarker(env['WINDSURF'])) return true;
  if (existsSync(join(ctx.baseDir, '.windsurf'))) return true;
  const home = ctx.homeDir ?? homedir();
  return existsSync(join(home, '.codeium', 'windsurf'));
}

/**
 * Ordered skill-install commands for one init run. Exported for unit tests.
 */
export function resolveProjectSkillInstallCommands(
  pm: PackageManager,
  ctx: {
    readonly baseDir: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly homeDir?: string;
  },
): readonly string[] {
  const windsurfDetected = isWindsurfDetected(ctx);
  return DEFAULT_SKILL_SOURCES.flatMap((source) => [
    formatSkillInstallCommand(pm, source),
    formatClaudeSkillInstallCommand(pm, source),
    ...(windsurfDetected ? [formatWindsurfSkillInstallCommand(pm, source)] : []),
  ]);
}

function formatPackageManagerCommand(pm: PackageManager, args: readonly string[]): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm dlx ${args.join(' ')}`;
    case 'yarn':
      return `yarn dlx ${args.join(' ')}`;
    case 'bun':
      return `bunx ${args.join(' ')}`;
    case 'deno':
      return `deno run -A npm:${args.join(' ')}`;
    case 'npm':
      return `npx ${args.join(' ')}`;
  }
}

/**
 * Parse the project-pm-formatted command into an exec call. The
 * format-then-parse split keeps the user-facing command string the same
 * as the surface the structured error advertises, so a user who copies
 * the error's `fix` line gets the same invocation that init just
 * attempted. Single quotes are preserved in the display form so `*` is
 * safe to copy into a shell, then stripped before `execFile`.
 */
function commandToExec(command: string): {
  readonly file: string;
  readonly args: readonly string[];
} {
  const tokens = (command.match(/'[^']*'|\S+/g) ?? []).map((token) =>
    token.startsWith("'") && token.endsWith("'") ? token.slice(1, -1) : token,
  );
  return { file: tokens[0] ?? 'npx', args: tokens.slice(1) };
}

/**
 * Runs the project-level skill install for every source in
 * `DEFAULT_SKILL_SOURCES`, in order. Returns
 * `{ ok: true, commands }` on success; throws a structured
 * `errorInitSkillInstallFailed` on the first failure (subsequent
 * sources are not attempted — the user opted into Prisma Next by
 * running `init` and a partial install would leave the project in an
 * ambiguous state). The throw is intentionally fatal — project-level
 * skill install is unconditional (modulo `--no-skill`).
 */
export async function runProjectLevelSkillInstall(ctx: {
  readonly baseDir: string;
  readonly pm: PackageManager;
  readonly filesWritten: readonly string[];
}): Promise<{ readonly ok: true; readonly commands: readonly string[] }> {
  const commands: string[] = [];
  const installCommands = resolveProjectSkillInstallCommands(ctx.pm, {
    baseDir: ctx.baseDir,
  });

  for (const command of installCommands) {
    const { file, args } = commandToExec(command);
    try {
      await exec(file, args, { cwd: ctx.baseDir });
      commands.push(command);
    } catch (err) {
      throw errorInitSkillInstallFailed({
        skillInstallCommand: command,
        filesWritten: ctx.filesWritten,
        cause:
          redactSecrets(readChildStderr(err)) || (err instanceof Error ? err.message : String(err)),
      });
    }
  }
  return { ok: true, commands };
}

function readChildStderr(err: unknown): string {
  if (err instanceof Error && 'stderr' in err) {
    return String((err as { stderr: string }).stderr ?? '');
  }
  return '';
}

/**
 * Strips credentials from a `scheme://user:pass@host/...` URL anywhere
 * in `stderr`. Package-manager stderr regularly contains credentialed
 * registry URLs (private npm registries, GitHub Packages tokens), and
 * those bubble into the structured `errorInitSkillInstallFailed`
 * envelope, which ends up in logs and CI output. Redact at the
 * boundary so we never re-emit a secret.
 *
 * Exported for unit tests.
 */
export function redactSecrets(stderr: string): string {
  if (!stderr) return stderr;
  return stderr.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+)@/g, '$1***@');
}

// -------------------------------------------------------------------
// Legacy file cleanup
// -------------------------------------------------------------------

/**
 * Hand-rolled skill stub path that init must not leave behind. Removed
 * on every init run so a project's `.agents/skills/prisma-next/` does
 * not shadow the installed Prisma Next skill cluster.
 */
export const LEGACY_SKILL_FILE = '.agents/skills/prisma-next/SKILL.md';
