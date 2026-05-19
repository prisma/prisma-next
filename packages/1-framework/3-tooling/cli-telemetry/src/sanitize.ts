/**
 * Input shape: a thin projection of commander's parsed-result surface.
 * The parent extracts these three fields from the program tree and the
 * leaf command's `opts()` result; the sanitiser does not consume raw
 * argv, never reads `process.argv`, and never sees flag values.
 */
export interface CommanderResultShape {
  /**
   * The full command path from the root program to the leaf, including
   * the root program name as the first element (the sanitiser drops it).
   * Example: `['prisma-next', 'migration', 'new']`.
   */
  readonly commandPath: readonly string[];
  /**
   * Positional arguments commander parsed for the leaf command.
   * **Intentionally never read.** Accepted so the call site doesn't have
   * to think about whether to pass it; the sanitiser's contract is that
   * positionals never leave the parent process.
   */
  readonly positionalArgs: readonly string[];
  /**
   * Commander's `opts()` result for the leaf command — the parsed
   * options map. The sanitiser uses **only its keys** as the flag-name
   * list; values are discarded.
   */
  readonly parsedOptions: Readonly<Record<string, unknown>>;
}

/**
 * Output shape: the sanitised projection that flows into the telemetry
 * payload. Two fields only — command name (space-delimited subcommand
 * path) and flag names (in commander's enumeration order).
 */
export interface SanitisedCommand {
  readonly command: string;
  readonly flags: readonly string[];
}

/**
 * Project commander's parsed result into the wire-shape command and
 * flag-name list. Pure; the only allowed inputs are the three fields of
 * `CommanderResultShape`.
 *
 * Sanitiser contract — no flag values, no positionals, no raw argv:
 *   - Drop the root program name (`commandPath[0]`); the wire ships
 *     `migration new`, not `prisma-next migration new`.
 *   - Project flag names from `Object.keys(parsedOptions)`; never read
 *     the corresponding values.
 *   - `positionalArgs` is accepted but never consumed; the field exists
 *     in the input type to make it obvious at the call site that
 *     positionals were deliberately excluded.
 */
export function sanitizeCommanderResult(input: CommanderResultShape): SanitisedCommand {
  const command = input.commandPath.slice(1).join(' ');
  const flags = Object.keys(input.parsedOptions);
  return { command, flags };
}
