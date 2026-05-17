import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { version as cliVersion } from '../../../package.json' with { type: 'json' };
import type { PackageManager } from './detect-package-manager';
import { errorInitSkillInstallFailed } from './errors';

const exec = promisify(execFile);

/**
 * Default skills source for published CLI builds.
 *
 * Points at the Prisma Next monorepo tag that matches the CLI's own
 * package version, with the `skills/` subpath so discovery's `searchPath`
 * is the user-facing cluster directly. Contributor skills live in a
 * top-level `skills-contrib/` directory that's not on upstream's
 * priority-discovery allowlist, so the subpath form gives consumers
 * exactly the user-facing skills regardless of upstream's `--all`
 * semantics.
 *
 * Background: upstream's `--all` flag deliberately bypasses the
 * `metadata.internal: true` filter, so frontmatter is not a reliable
 * defence against contributor-skill leakage. The subpath URL is.
 */
export const DEFAULT_AGENT_SKILL_SOURCE = `prisma/prisma-next/skills#v${cliVersion}`;

/**
 * Test-only escape hatch for pinning a local or in-flight skills source.
 * Production runs leave this unset, so installs always use
 * `DEFAULT_AGENT_SKILL_SOURCE`.
 */
function resolveAgentSkillSource(): string {
  const override = process.env['PRISMA_NEXT_SKILLS_REF']?.trim();
  return override && override.length > 0 ? override : DEFAULT_AGENT_SKILL_SOURCE;
}

/**
 * The skill-install command, formatted for the project's detected
 * package manager. `npx`/`pnpm dlx`/`bunx` are interchangeable to the
 * user; we pick the variant that matches the rest of the install step
 * so a single project consistently uses one runner.
 *
 * `--all` auto-selects every skill in the cluster and every detected
 * agent runtime, skipping the multi-select prompts the `skills` CLI
 * shows by default. A non-interactive scaffold step cannot present
 * prompts, and the cluster is designed to be installed as a unit (the
 * router skill routes between the workflow-scoped siblings). Users who
 * want a narrower install run
 * `npx skills add prisma/prisma-next/skills#v<version>` themselves
 * after `init` with the flags they want.
 *
 * Exported for unit tests so the per-PM dispatch can be asserted
 * without a live subprocess.
 */
export function formatSkillInstallCommand(pm: PackageManager): string {
  const args = ['skills', 'add', resolveAgentSkillSource(), '--all'];
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
 * Runs the project-level skill install. Returns `{ ok: true, command }`
 * on success; throws a structured `errorInitSkillInstallFailed` on
 * failure. The throw is intentionally fatal — project-level skill
 * install is unconditional (modulo `--no-skill`) and the user opted
 * into Prisma Next by running `init`. A silent skip would defeat the
 * onboarding-to-zero contract.
 */
export async function runProjectLevelSkillInstall(ctx: {
  readonly baseDir: string;
  readonly pm: PackageManager;
  readonly filesWritten: readonly string[];
}): Promise<{ readonly ok: true; readonly command: string }> {
  const command = formatSkillInstallCommand(ctx.pm);
  const { file, args } = commandToExec(command);
  try {
    await exec(file, args, { cwd: ctx.baseDir });
    return { ok: true, command };
  } catch (err) {
    throw errorInitSkillInstallFailed({
      skillInstallCommand: command,
      filesWritten: ctx.filesWritten,
      cause:
        redactSecrets(readChildStderr(err)) || (err instanceof Error ? err.message : String(err)),
    });
  }
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
