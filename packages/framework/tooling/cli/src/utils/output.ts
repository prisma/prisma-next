import { blue, bold, cyan, dim, green, magenta, red } from 'colorette';
import type { Command } from 'commander';
import type { EmitContractResult } from '../api/emit-contract';
import type { VerifyDatabaseResult } from '../api/verify-database';
import type { CliErrorEnvelope } from './cli-errors';
import type { GlobalFlags } from './global-flags';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Formats a timestamp for output.
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Creates a prefix string if timestamps are enabled.
 */
function createPrefix(flags: GlobalFlags): string {
  return flags.timestamps ? `[${formatTimestamp()}] ` : '';
}

/**
 * Checks if verbose output is enabled at the specified level.
 */
function isVerbose(flags: GlobalFlags, level: 1 | 2): boolean {
  return (flags.verbose ?? 0) >= level;
}

/**
 * Creates a color-aware formatter function.
 * Returns a function that applies the color only if colors are enabled.
 */
function createColorFormatter<T extends (text: string) => string>(
  useColor: boolean,
  colorFn: T,
): (text: string) => string {
  return useColor ? colorFn : (text: string) => text;
}

/**
 * Formats text with dim styling if colors are enabled.
 */
function formatDim(useColor: boolean, text: string): string {
  return useColor ? dim(text) : text;
}

// ============================================================================
// Emit Output Formatters
// ============================================================================

/**
 * Formats human-readable output for contract emit.
 */
export function formatEmitOutput(result: EmitContractResult, flags: GlobalFlags): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];
  const prefix = createPrefix(flags);

  lines.push(`${prefix}✔ Emitted contract.json → ${result.files.json}`);
  lines.push(`${prefix}✔ Emitted contract.d.ts → ${result.files.dts}`);
  lines.push(`${prefix}  coreHash: ${result.coreHash}`);
  if (result.profileHash) {
    lines.push(`${prefix}  profileHash: ${result.profileHash}`);
  }
  if (isVerbose(flags, 1)) {
    lines.push(`${prefix}  Total time: ${result.timings.total}ms`);
  }

  return lines.join('\n');
}

/**
 * Formats JSON output for contract emit.
 */
export function formatEmitJson(result: EmitContractResult): string {
  const output = {
    ok: true,
    coreHash: result.coreHash,
    ...(result.profileHash ? { profileHash: result.profileHash } : {}),
    outDir: result.outDir,
    files: result.files,
    timings: result.timings,
  };

  return JSON.stringify(output, null, 2);
}

// ============================================================================
// Error Output Formatters
// ============================================================================

/**
 * Formats error output for human-readable display.
 */
export function formatErrorOutput(error: CliErrorEnvelope, flags: GlobalFlags): string {
  const lines: string[] = [];
  const prefix = createPrefix(flags);
  const useColor = flags.color !== false;
  const formatRed = createColorFormatter(useColor, red);
  const formatDimText = (text: string) => formatDim(useColor, text);

  lines.push(`${prefix}${formatRed('✖')} ${error.summary} (${error.code})`);

  if (error.why) {
    lines.push(`${prefix}${formatDimText(`  Why: ${error.why}`)}`);
  }
  if (error.fix) {
    lines.push(`${prefix}${formatDimText(`  Fix: ${error.fix}`)}`);
  }
  if (error.where?.path) {
    const whereLine = error.where.line
      ? `${error.where.path}:${error.where.line}`
      : error.where.path;
    lines.push(`${prefix}${formatDimText(`  Where: ${whereLine}`)}`);
  }
  if (error.docsUrl && isVerbose(flags, 1)) {
    lines.push(formatDimText(error.docsUrl));
  }
  if (isVerbose(flags, 2) && error.meta) {
    lines.push(`${prefix}${formatDimText(`  Meta: ${JSON.stringify(error.meta, null, 2)}`)}`);
  }

  return lines.join('\n');
}

/**
 * Formats error output as JSON.
 */
export function formatErrorJson(error: CliErrorEnvelope): string {
  return JSON.stringify(error, null, 2);
}

// ============================================================================
// Verify Output Formatters
// ============================================================================

/**
 * Formats human-readable output for database verify.
 */
export function formatVerifyOutput(result: VerifyDatabaseResult, flags: GlobalFlags): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];
  const prefix = createPrefix(flags);
  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatRed = createColorFormatter(useColor, red);
  const formatDimText = (text: string) => formatDim(useColor, text);

  if (result.ok) {
    lines.push(`${prefix}${formatGreen('✔')} ${result.summary}`);
    lines.push(`${prefix}${formatDimText(`  coreHash: ${result.contract.coreHash}`)}`);
    if (result.contract.profileHash) {
      lines.push(`${prefix}${formatDimText(`  profileHash: ${result.contract.profileHash}`)}`);
    }
  } else {
    lines.push(`${prefix}${formatRed('✖')} ${result.summary} (${result.code})`);
  }

  if (isVerbose(flags, 1)) {
    if (result.codecCoverageSkipped) {
      lines.push(
        `${prefix}${formatDimText('  Codec coverage check skipped (helper returned no supported types)')}`,
      );
    }
    lines.push(`${prefix}${formatDimText(`  Total time: ${result.timings.total}ms`)}`);
  }

  return lines.join('\n');
}

/**
 * Formats JSON output for database verify.
 */
export function formatVerifyJson(result: VerifyDatabaseResult): string {
  const output = {
    ok: result.ok,
    ...(result.code ? { code: result.code } : {}),
    summary: result.summary,
    contract: result.contract,
    ...(result.marker ? { marker: result.marker } : {}),
    target: result.target,
    ...(result.missingCodecs ? { missingCodecs: result.missingCodecs } : {}),
    ...(result.meta ? { meta: result.meta } : {}),
    timings: result.timings,
  };

  return JSON.stringify(output, null, 2);
}

// ============================================================================
// Styled Output Formatters
// ============================================================================

/**
 * Creates a simple arrow marker.
 */
function createPrismaNextBadge(useColor: boolean): string {
  return useColor ? bold(green('prisma-next')) : 'prisma-next';
}

/**
 * Creates a padding function.
 */
function createPadFunction(): (s: string, w: number) => string {
  return (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
}

/**
 * Formats a header line: brand + operation + intent
 */
function formatHeaderLine(options: {
  readonly brand: string;
  readonly operation: string;
  readonly intent: string;
}): string {
  if (options.operation) {
    return `${options.brand} ${options.operation} ➜ ${options.intent}`;
  }
  return `${options.brand} ➜ ${options.intent}`;
}

/**
 * Formats a label/value line with padding and coloring.
 */
function formatLabelValueLine(options: {
  readonly label: string;
  readonly value: string;
  readonly maxLabelWidth: number;
  readonly useColor: boolean;
  readonly formatDimText: (text: string) => string;
}): string {
  const pad = createPadFunction();
  const labelPadded = pad(options.label, options.maxLabelWidth);
  const labelColored = options.useColor ? cyan(labelPadded) : labelPadded;
  return `${options.formatDimText('│')} ${labelColored}  ${options.value}`;
}

/**
 * Formats an option flag with placeholder coloring.
 */
function formatOptionFlag(flags: string, maxWidth: number, useColor: boolean): string {
  const pad = createPadFunction();
  const flagsPadded = pad(flags, maxWidth);
  if (useColor) {
    // Color placeholders in magenta, then wrap in cyan
    const flagsWithPlaceholders = flagsPadded.replace(/(<[^>]+>)/g, (match: string) =>
      magenta(match),
    );
    return cyan(flagsWithPlaceholders);
  }
  return flagsPadded;
}

/**
 * Formats a "Read more" URL line.
 * The "Read more" label is in default color (not cyan), and the URL is blue.
 */
function formatReadMoreLine(options: {
  readonly url: string;
  readonly maxLabelWidth: number;
  readonly useColor: boolean;
  readonly formatDimText: (text: string) => string;
}): string {
  const pad = createPadFunction();
  const labelPadded = pad('Read more', options.maxLabelWidth);
  // Label is default color (not cyan)
  const valueColored = options.useColor ? blue(options.url) : options.url;
  return `${options.formatDimText('│')} ${labelPadded}  ${valueColored}`;
}

/**
 * Formats multiline description with "Prisma Next" in green.
 */
function formatMultilineDescription(options: {
  readonly descriptionLines: readonly string[];
  readonly useColor: boolean;
  readonly formatDimText: (text: string) => string;
}): string[] {
  const lines: string[] = [];
  const formatGreen = (text: string) => (options.useColor ? green(text) : text);
  for (const descLine of options.descriptionLines) {
    // Replace "Prisma Next" with green version if present
    const formattedLine = descLine.replace(/Prisma Next/g, (match) => formatGreen(match));
    lines.push(`${options.formatDimText('│')} ${formattedLine}`);
  }
  return lines;
}

/**
 * Formats the header in the new experimental visual style.
 * This header appears at the start of command output, showing the operation,
 * intent, documentation link, and parameters.
 */
export function formatStyledHeader(options: {
  readonly command: string;
  readonly description: string;
  readonly url?: string;
  readonly details: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly flags: GlobalFlags;
}): string {
  const lines: string[] = [];
  const useColor = options.flags.color !== false;
  const formatDimText = (text: string) => formatDim(useColor, text);

  // Header: arrow + operation badge + intent
  const brand = createPrismaNextBadge(useColor);
  const opName = options.command.split(' ').slice(-1)[0] || 'emit';
  const operation = useColor ? bold(opName) : opName;
  const intent = formatDimText(options.description);
  lines.push(formatHeaderLine({ brand, operation, intent }));
  lines.push(formatDimText('│')); // Vertical line separator between command and params

  // Calculate max label width (including "Read more" if URL is present)
  const allLabels = options.url
    ? [...options.details.map((d) => d.label), 'Read more']
    : options.details.map((d) => d.label);
  const maxLabel = allLabels.reduce((n, label) => Math.max(n, label.length), 0);

  // Format details (same style as help text options)
  for (const detail of options.details) {
    lines.push(
      formatLabelValueLine({
        label: detail.label,
        value: detail.value,
        maxLabelWidth: maxLabel,
        useColor,
        formatDimText,
      }),
    );
  }

  // Add "Read more" URL if present (same style as help text)
  if (options.url) {
    lines.push(formatDimText('│')); // Separator line before "Read more"
    lines.push(
      formatReadMoreLine({ url: options.url, maxLabelWidth: maxLabel, useColor, formatDimText }),
    );
  }

  lines.push(formatDimText('└'));

  return `${lines.join('\n')}\n`;
}

/**
 * Formats a success message in the styled output format.
 */
export function formatSuccessMessage(flags: GlobalFlags): string {
  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  return `${formatGreen('✓')} Success`;
}

// ============================================================================
// Help Output Formatters
// ============================================================================

/**
 * Maps command paths to their documentation URLs.
 */
function getCommandDocsUrl(commandPath: string): string | undefined {
  const docsMap: Record<string, string> = {
    'contract emit': 'https://pris.ly/contract-emit',
    'db verify': 'https://pris.ly/db-verify',
  };
  return docsMap[commandPath];
}

/**
 * Builds the full command path from a command and its parents.
 */
function buildCommandPath(command: Command): string {
  const parts: string[] = [];
  let current: Command | undefined = command;
  while (current && current.name() !== 'prisma-next') {
    parts.unshift(current.name());
    current = current.parent ?? undefined;
  }
  return parts.join(' ');
}

/**
 * Formats help output for a command using the styled format.
 */
export function formatCommandHelp(options: {
  readonly command: Command;
  readonly flags: GlobalFlags;
}): string {
  const { command, flags } = options;
  const lines: string[] = [];
  const useColor = flags.color !== false;
  const formatDimText = (text: string) => formatDim(useColor, text);

  // Build full command path (e.g., "db verify")
  const commandPath = buildCommandPath(command);
  const description = command.description() || '';
  const descriptionLines = description.split('\n').filter((line) => line.trim().length > 0);
  const shortDescription = descriptionLines[0] || '';
  const longDescription = descriptionLines.slice(1);

  // Header: "prisma-next <full-command-path> ➜ <short-description>"
  const brand = createPrismaNextBadge(useColor);
  const operation = useColor ? bold(commandPath) : commandPath;
  const intent = formatDimText(shortDescription);
  lines.push(formatHeaderLine({ brand, operation, intent }));
  lines.push(formatDimText('│')); // Vertical line separator between command and params

  // Extract options and format them
  const optionsList = command.options.map((opt) => {
    const flags = opt.flags;
    const description = opt.description || '';
    return { flags, description };
  });

  // Collect all label lengths first (before colorization) to calculate max width
  const labelLengths: number[] = [];

  if (optionsList.length > 0) {
    for (const opt of optionsList) {
      labelLengths.push(opt.flags.length);
    }
  }

  // Extract subcommands if any
  const subcommands = command.commands.filter((cmd) => !cmd.name().startsWith('_'));

  // Helper function for padding
  const pad = createPadFunction();

  // Format subcommands as a tree if present
  if (subcommands.length > 0) {
    // Find max subcommand name length for alignment
    let maxSubcommandNameLength = 0;
    for (const subcmd of subcommands) {
      maxSubcommandNameLength = Math.max(maxSubcommandNameLength, subcmd.name().length);
    }

    // Format each subcommand with tree structure
    for (let j = 0; j < subcommands.length; j++) {
      const subcmd = subcommands[j];
      if (!subcmd) continue;

      const isLastSubcommand = j === subcommands.length - 1 && optionsList.length === 0;
      const subcommandName = pad(subcmd.name(), maxSubcommandNameLength);
      const subcommandNameColored = useColor ? cyan(subcommandName) : subcommandName;
      // Extract only the first line of description for subcommand listings
      const fullDescription = subcmd.description() || '';
      const shortDescription = fullDescription.split('\n')[0] || '';

      // Use tree characters: └─ for last subcommand, ├─ for others
      const treeChar = isLastSubcommand ? '└' : '├';
      lines.push(
        `${formatDimText('│')} ${formatDimText(treeChar)}─ ${subcommandNameColored}  ${shortDescription}`,
      );
    }
  }

  // Calculate max label width for options
  const maxLabel =
    optionsList.length > 0 ? Math.max(...optionsList.map((opt) => opt.flags.length)) : 0;

  // Add separator between subcommands and options if both exist
  if (subcommands.length > 0 && optionsList.length > 0) {
    lines.push(formatDimText('│'));
  }

  // Format options
  if (optionsList.length > 0) {
    for (const opt of optionsList) {
      const flagsColored = formatOptionFlag(opt.flags, maxLabel, useColor);
      lines.push(`${formatDimText('│')} ${flagsColored}  ${opt.description}`);
    }
  }

  // Add docs URL if available (with separator line before it)
  const docsUrl = getCommandDocsUrl(commandPath);
  if (docsUrl) {
    lines.push(formatDimText('│')); // Separator line between params and docs
    lines.push(
      formatReadMoreLine({ url: docsUrl, maxLabelWidth: maxLabel, useColor, formatDimText }),
    );
  }

  // Multi-line description (if present) - shown after all other content
  if (longDescription.length > 0) {
    lines.push(formatDimText('│')); // Separator line before description
    lines.push(
      ...formatMultilineDescription({ descriptionLines: longDescription, useColor, formatDimText }),
    );
  }

  lines.push(formatDimText('└'));

  return `${lines.join('\n')}\n`;
}

/**
 * Formats help output for the root program using the styled format.
 */
export function formatRootHelp(options: {
  readonly program: Command;
  readonly flags: GlobalFlags;
}): string {
  const { program, flags } = options;
  const lines: string[] = [];
  const useColor = flags.color !== false;
  const formatDimText = (text: string) => formatDim(useColor, text);

  // Header: "prisma-next → Manage your data layer"
  const brand = createPrismaNextBadge(useColor);
  const shortDescription = 'Manage your data layer';
  const intent = formatDimText(shortDescription);
  lines.push(formatHeaderLine({ brand, operation: '', intent }));
  lines.push(formatDimText('│')); // Vertical line separator between command and params

  // Extract top-level commands (exclude hidden commands starting with '_' and the 'help' command)
  const topLevelCommands = program.commands.filter(
    (cmd) => !cmd.name().startsWith('_') && cmd.name() !== 'help',
  );

  // Extract global options (needed to determine if last command)
  const globalOptions = program.options.map((opt) => {
    const flags = opt.flags;
    const description = opt.description || '';
    return { flags, description };
  });

  // Build command tree
  if (topLevelCommands.length > 0) {
    // Find max subcommand name length for alignment
    let maxSubcommandNameLength = 0;
    for (const cmd of topLevelCommands) {
      const subcommands = cmd.commands.filter((subcmd) => !subcmd.name().startsWith('_'));
      for (const subcmd of subcommands) {
        maxSubcommandNameLength = Math.max(maxSubcommandNameLength, subcmd.name().length);
      }
      // Also check the command itself if it has no subcommands
      if (subcommands.length === 0) {
        maxSubcommandNameLength = Math.max(maxSubcommandNameLength, cmd.name().length);
      }
    }

    const pad = createPadFunction();

    // Format each top-level command
    for (let i = 0; i < topLevelCommands.length; i++) {
      const cmd = topLevelCommands[i];
      if (!cmd) continue;

      const subcommands = cmd.commands.filter((subcmd) => !subcmd.name().startsWith('_'));
      const commandName = useColor ? cyan(cmd.name()) : cmd.name();
      const isLastCommand = i === topLevelCommands.length - 1;

      if (subcommands.length > 0) {
        // Command with subcommands - show command name, then tree-structured subcommands
        const prefix = isLastCommand ? formatDimText('└') : formatDimText('├');
        lines.push(`${formatDimText('│')} ${prefix}─ ${commandName}`);

        for (let j = 0; j < subcommands.length; j++) {
          const subcmd = subcommands[j];
          if (!subcmd) continue;

          const isLastSubcommand = j === subcommands.length - 1;
          const subcommandName = pad(subcmd.name(), maxSubcommandNameLength);
          const subcommandNameColored = useColor ? cyan(subcommandName) : subcommandName;
          const fullDescription = subcmd.description() || '';
          const descriptionLines = fullDescription
            .split('\n')
            .filter((line) => line.trim().length > 0);
          const shortDescription = descriptionLines[0] || '';
          const longDescription = descriptionLines.slice(1);

          // Use tree characters: └─ for last subcommand, ├─ for others
          const treeChar = isLastSubcommand ? '└' : '├';
          const continuation = isLastCommand && isLastSubcommand ? ' ' : formatDimText('│');
          lines.push(
            `${formatDimText('│')} ${continuation}  ${formatDimText(treeChar)}─ ${subcommandNameColored}  ${shortDescription}`,
          );

          // Add multiline description if present
          if (longDescription.length > 0) {
            for (const descLine of longDescription) {
              lines.push(`${formatDimText('│')} ${continuation}     ${descLine}`);
            }
          }
        }
      } else {
        // Standalone command - show command name and description on same line
        const prefix = isLastCommand ? formatDimText('└') : formatDimText('├');
        const commandNamePadded = pad(cmd.name(), maxSubcommandNameLength);
        const commandNameColored = useColor ? cyan(commandNamePadded) : commandNamePadded;
        const description = cmd.description() || '';
        lines.push(`${formatDimText('│')} ${prefix}─ ${commandNameColored}  ${description}`);
      }
    }
  }

  // Add separator between commands and options if both exist
  if (topLevelCommands.length > 0 && globalOptions.length > 0) {
    lines.push(formatDimText('│'));
  }

  // Format global options
  if (globalOptions.length > 0) {
    const maxOptionLength = Math.max(...globalOptions.map((opt) => opt.flags.length));
    const pad = createPadFunction();

    for (const opt of globalOptions) {
      const flagsPadded = pad(opt.flags, maxOptionLength);
      let flagsColored = flagsPadded;
      if (useColor) {
        // Color placeholders in magenta, then wrap in cyan
        flagsColored = flagsPadded.replace(/(<[^>]+>)/g, (match: string) => magenta(match));
        flagsColored = cyan(flagsColored);
      }
      lines.push(`${formatDimText('│')} ${flagsColored}  ${opt.description}`);
    }
  }

  // Multi-line description (white, not dimmed, with "Prisma Next" in green) - shown at bottom
  const formatGreen = (text: string) => (useColor ? green(text) : text);
  const descriptionLines = [
    `Use ${formatGreen('Prisma Next')} to define your application's data layer in a declarative contract. Describe your schema as`,
    "a data contract. Sign your database and application with the same contract to guarantee they're compatible.",
    'Write migrations to change your contract and database safely.',
  ];
  if (descriptionLines.length > 0) {
    lines.push(formatDimText('│')); // Separator line before description
    for (const descLine of descriptionLines) {
      lines.push(`${formatDimText('│')} ${descLine}`);
    }
  }

  lines.push(formatDimText('└'));

  return `${lines.join('\n')}\n`;
}
