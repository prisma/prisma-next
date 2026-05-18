import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { PackageManager } from './detect-package-manager';
import { errorInitSkillInstallFailed } from './errors';

const exec = promisify(execFile);

/**
 * Default base for the GitHub-URL form `<owner>/<repo>` consumed by
 * upstream `skills add`. Each `SkillSource` joins this base with its
 * own subpath.
 */
export const DEFAULT_AGENT_SKILL_BASE = 'prisma/prisma-next';

/**
 * One discovery scope inside the Prisma Next monorepo. The CLI emits
 * one `skills add <base>/<subpath> --all` invocation per source
 * during `init`.
 */
export interface SkillSource {
  readonly subpath: string;
  readonly description: string;
}

export const DEFAULT_AGENT_SKILL_SOURCES: readonly SkillSource[] = [
  {
    subpath: 'skills',
    description: 'usage skills',
  },
  {
    subpath: 'skills/upgrade',
    description: 'upgrade skill (always tracks `main`)',
  },
  {
    subpath: 'skills/extension-author',
    description: 'extension-author skill (always tracks `main`)',
  },
];

export const CLAUDE_CODE_PROJECT_DIR = '.claude';

/**
 * Test-only escape hatch for pinning the install base to a local
 * checkout. Production runs leave this unset, so installs always use
 * `DEFAULT_AGENT_SKILL_BASE`.
 */
function resolveAgentSkillBase(): string {
  const override = process.env['PRISMA_NEXT_SKILLS_BASE']?.trim();
  return override && override.length > 0 ? override : DEFAULT_AGENT_SKILL_BASE;
}

/**
 * Build the `<base>/<subpath>` URL the `skills` CLI will
 * resolve. Exported for unit tests so the per-source format can be
 * asserted without going through the full install loop.
 */
export function formatSkillSourceUrl(source: SkillSource): string {
  const base = resolveAgentSkillBase();
  return `${base}/${source.subpath}`;
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
  const args = ['skills', 'add', formatSkillSourceUrl(source), '--all'];
  return formatPackageManagerCommand(pm, args);
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
 * attempted.
 */
function commandToExec(command: string): {
  readonly file: string;
  readonly args: readonly string[];
} {
  const tokens = command.split(/\s+/);
  return { file: tokens[0] ?? 'npx', args: tokens.slice(1) };
}

/**
 * The upstream `skills` CLI installs non-universal project agents only when
 * that agent's root directory already exists. Claude Code is one of those
 * agents (`.claude/skills`), so create the root before `skills add --all`
 * and let the official installer create symlinks from `.claude/skills/*`
 * back to the canonical `.agents/skills/*` copies.
 */
export async function ensureClaudeCodeProjectRoot(baseDir: string): Promise<void> {
  await mkdir(join(baseDir, CLAUDE_CODE_PROJECT_DIR), { recursive: true });
}

/**
 * Runs the project-level skill install for every source in
 * `DEFAULT_AGENT_SKILL_SOURCES`, in order. Returns
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
  const installCommands = DEFAULT_AGENT_SKILL_SOURCES.map((source) =>
    formatSkillInstallCommand(ctx.pm, source),
  );

  await ensureClaudeCodeProjectRoot(ctx.baseDir);

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
