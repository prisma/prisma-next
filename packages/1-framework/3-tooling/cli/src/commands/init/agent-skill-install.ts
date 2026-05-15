import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { promisify } from 'node:util';
import { dirname, join } from 'pathe';
import type { PackageManager } from './detect-package-manager';
import { errorInitSkillInstallFailed } from './errors';

const exec = promisify(execFile);

/**
 * The npm package the agent-skill install dispatches to. Version-locked
 * to Prisma Next via the consumer project's `package.json`; the install
 * subprocess picks up whatever version is resolvable at install time.
 */
export const AGENT_SKILL_PACKAGE = '@prisma-next/agent-skill';

/**
 * The skill-install command, formatted for the project's detected
 * package manager. `npx`/`pnpm dlx`/`bunx` are interchangeable to the
 * user; we pick the variant that matches the rest of the install step
 * so a single project consistently uses one runner.
 *
 * Exported for unit tests so the per-PM dispatch can be asserted
 * without a live subprocess.
 */
export function formatSkillInstallCommand(pm: PackageManager, userLevel: boolean): string {
  const args = userLevel
    ? ['skills', 'add', '--user', AGENT_SKILL_PACKAGE]
    : ['skills', 'add', AGENT_SKILL_PACKAGE];
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
 * as the surface the structured error advertises (FR9), so a user who
 * copies the error's `fix` line gets the same invocation that init
 * just attempted.
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
 * Layer 1 onboarding-to-zero contract from `usage-skill.spec.md`.
 */
export async function runProjectLevelSkillInstall(ctx: {
  readonly baseDir: string;
  readonly pm: PackageManager;
  readonly filesWritten: readonly string[];
}): Promise<{ readonly ok: true; readonly command: string }> {
  const command = formatSkillInstallCommand(ctx.pm, false);
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

/**
 * Runs the user-level skill install. Non-fatal: a failure surfaces as
 * a warning (caller pushes the returned string into the warnings
 * array) and the run continues. Per FR10: user-level install is opt-in
 * surface, and a failure there should not block the user's main
 * scaffold.
 */
export async function runUserLevelSkillInstall(ctx: {
  readonly baseDir: string;
  readonly pm: PackageManager;
}): Promise<
  | { readonly ok: true; readonly command: string }
  | { readonly ok: false; readonly warning: string; readonly command: string }
> {
  const command = formatSkillInstallCommand(ctx.pm, true);
  const { file, args } = commandToExec(command);
  try {
    await exec(file, args, { cwd: ctx.baseDir });
    return { ok: true, command };
  } catch (err) {
    const cause =
      redactSecrets(readChildStderr(err)) || (err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      command,
      warning: [
        `User-level install of ${AGENT_SKILL_PACKAGE} failed and was skipped:`,
        `  ${cause.trim().split('\n')[0] ?? cause}`,
        'Install manually later if you want it everywhere:',
        `  ${command}`,
      ].join('\n'),
    };
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
 * envelope plus user-level warnings — both of which end up in logs and
 * CI output. Redact at the boundary so we never re-emit a secret.
 *
 * Exported for unit tests.
 */
export function redactSecrets(stderr: string): string {
  if (!stderr) return stderr;
  return stderr.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+)@/g, '$1***@');
}

// -------------------------------------------------------------------
// Marker file — XDG-compliant first-run prompt suppression
// -------------------------------------------------------------------

/**
 * Shape of the marker file at
 * `${XDG_CONFIG_HOME ?? ~/.config}/prisma-next/init-state.json`
 * (POSIX) or `%APPDATA%\prisma-next\init-state.json` (Windows).
 *
 * Forward-compatible: readers must ignore unknown fields. New fields
 * may be added in future versions.
 */
export interface InitMarkerState {
  readonly userSkillPromptShown: boolean;
  readonly shownAt: string;
  readonly answeredYes: boolean;
}

/**
 * Returns the marker file's absolute path for the current host.
 * XDG_CONFIG_HOME wins if set; otherwise `~/.config/prisma-next/...`
 * on POSIX, `%APPDATA%\prisma-next\...` on Windows.
 *
 * Exported for unit tests.
 */
export function markerFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env['XDG_CONFIG_HOME'];
  if (xdg !== undefined && xdg.length > 0) {
    return join(xdg, 'prisma-next', 'init-state.json');
  }
  if (platform() === 'win32') {
    const appData = env['APPDATA'];
    if (appData !== undefined && appData.length > 0) {
      return join(appData, 'prisma-next', 'init-state.json');
    }
  }
  return join(homedir(), '.config', 'prisma-next', 'init-state.json');
}

/**
 * Reads the marker file. Returns `null` on every failure mode
 * (missing file, unreadable, malformed JSON) — the file is best-
 * effort UX state per NFR5; the CLI never reasons about install
 * state from it.
 *
 * Exported for unit tests.
 */
export function readMarker(path: string = markerFilePath()): InitMarkerState | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    return {
      userSkillPromptShown: Boolean(obj['userSkillPromptShown']),
      shownAt: typeof obj['shownAt'] === 'string' ? (obj['shownAt'] as string) : '',
      answeredYes: Boolean(obj['answeredYes']),
    };
  } catch {
    return null;
  }
}

/**
 * Writes the marker file at `${markerFilePath()}` with `0600`
 * permissions on POSIX (per the spec, unrelated processes should not
 * be able to observe the prompt state). Best-effort: failures are
 * swallowed since the marker is purely a UX nicety; a missing marker
 * just re-fires the prompt on the next run.
 *
 * Exported for unit tests.
 */
export function writeMarker(state: InitMarkerState, path: string = markerFilePath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch {
    // Marker is best-effort; an unwritable HOME (read-only container,
    // permission failure) should not block the scaffold.
  }
}

// -------------------------------------------------------------------
// Legacy file cleanup
// -------------------------------------------------------------------

/**
 * Hand-rolled skill stub path that init must not leave behind. Removed
 * on every init run so a project's `.agents/skills/prisma-next/` does
 * not shadow the published `@prisma-next/agent-skill` package.
 */
export const LEGACY_SKILL_FILE = '.agents/skills/prisma-next/SKILL.md';
