/**
 * Stable exit codes for the `init` command.
 *
 * These are part of the command's public contract. AI agents and CI scripts
 * branch on them (FR1.6), so the values must remain stable across versions.
 *
 * The CLI-domain convention used elsewhere in the project assigns 2 to
 * "preconditions not met" / "bad input" and 1 to "internal/runtime error";
 * `init` follows that convention and adds finer-grained codes for the two
 * fallible side effects it owns (install + emit) and one for "user aborted
 * an interactive prompt" so callers can distinguish "the user said no" from
 * "we never got to ask".
 */

export const INIT_EXIT_OK = 0;

/**
 * Anything we did not anticipate. Maps to the generic "RUN" error domain.
 */
export const INIT_EXIT_INTERNAL_ERROR = 1;

/**
 * Preconditions not met. The caller asked for something we cannot do
 * without more input or a different environment. Examples:
 *   - missing `package.json` / `deno.json`
 *   - non-interactive mode without enough flags to proceed
 *   - re-init without `--force` in non-interactive mode
 */
export const INIT_EXIT_PRECONDITION = 2;

/**
 * The user actively aborted an interactive prompt (Ctrl-C, declined the
 * re-init confirmation, etc.). Distinct from PRECONDITION because the user
 * was given the choice and made it; no diagnostic is needed.
 */
export const INIT_EXIT_USER_ABORTED = 3;

/**
 * Dependency installation step failed and was not recoverable. `init` does
 * not currently fail-fast on install errors (it falls back to printing
 * manual install instructions), so this code is reserved for future use
 * when the install path is hardened (R4 / FR7).
 */
export const INIT_EXIT_INSTALL_FAILED = 4;

/**
 * Contract emit step failed. Reserved for the same reason as
 * `INIT_EXIT_INSTALL_FAILED` — emit failures currently degrade gracefully
 * with a manual-step note.
 */
export const INIT_EXIT_EMIT_FAILED = 5;
