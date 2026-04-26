/**
 * The package.json `scripts` entries `init` adds idempotently (FR3.5).
 * The script *name* mirrors the CLI subcommand path (`contract:emit` →
 * `prisma-next contract emit`) so the script is greppable: a user
 * encountering `npm run contract:emit` in CI logs can navigate
 * straight to the equivalent CLI invocation.
 *
 * No watch-mode entry is included (Spec Decision 9) — file-watching is
 * the build tool's job (Vite plugin, `tsc --watch`, etc.).
 */
export interface RequiredScript {
  readonly name: string;
  readonly command: string;
}

export const REQUIRED_SCRIPTS: readonly RequiredScript[] = [
  { name: 'contract:emit', command: 'prisma-next contract emit' },
];

export interface PackageScriptsMergeResult {
  /**
   * The new package.json content. `null` when no changes are required
   * (every required script is already present with the correct
   * command).
   */
  readonly content: string | null;
  /**
   * Structured warnings raised when an existing script of the same
   * name maps to a different command. Each warning names the script,
   * the existing command, and the command we wanted to write — the
   * user can decide whether to keep their override or update it.
   */
  readonly warnings: readonly string[];
}

/**
 * Idempotent `package.json#scripts` merge with collision detection
 * (FR3.5 / FR9.3):
 *
 * - If a required script is **missing**, append it.
 * - If a required script is **already present and identical**, leave
 *   the file alone (idempotency).
 * - If a required script is **present but maps to a different command**,
 *   skip the write for that script and surface a structured warning.
 *   The user's override is sacred — `init` should never silently
 *   overwrite a custom build pipeline.
 *
 * Preserves the existing key order (so a user who has alphabetised
 * their scripts does not see them reshuffled) and appends new entries
 * at the end.
 *
 * The `package.json` is parsed and re-stringified through `JSON` —
 * comments are not preserved (package.json does not support them per
 * spec). Trailing newline matches the original input's trailing
 * newline behaviour.
 */
export function mergePackageScripts(
  existing: string,
  required: readonly RequiredScript[] = REQUIRED_SCRIPTS,
): PackageScriptsMergeResult {
  const parsed = JSON.parse(existing) as Record<string, unknown>;
  const scripts: Record<string, string> =
    typeof parsed['scripts'] === 'object' && parsed['scripts'] !== null
      ? { ...(parsed['scripts'] as Record<string, string>) }
      : {};

  const warnings: string[] = [];
  let mutated = false;

  for (const { name, command } of required) {
    const existingValue = scripts[name];
    if (existingValue === undefined) {
      scripts[name] = command;
      mutated = true;
      continue;
    }
    if (existingValue !== command) {
      warnings.push(
        `package.json already has a "${name}" script with a different command — keeping yours.\n  existing: ${existingValue}\n  expected: ${command}\nIf you want the default, remove your "${name}" script and re-run \`init\`.`,
      );
    }
  }

  if (!mutated) {
    return { content: null, warnings };
  }

  parsed['scripts'] = scripts;
  const trailingNewline = existing.endsWith('\n') ? '\n' : '';
  return { content: `${JSON.stringify(parsed, null, 2)}${trailingNewline}`, warnings };
}
