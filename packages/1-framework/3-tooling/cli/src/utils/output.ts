import { relative } from 'node:path';
import { ifDefined } from '@prisma-next/utils/defined';
import { bgGreen, blue, bold, cyan, dim, green, magenta, red, yellow } from 'colorette';
import type { Command } from 'commander';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import wrapAnsi from 'wrap-ansi';
// EmitContractResult type for CLI output formatting (includes file paths)
export interface EmitContractResult {
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
  readonly outDir: string;
  readonly files: {
    readonly json: string;
    readonly dts: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

import type { CoreSchemaView, SchemaTreeNode } from '@prisma-next/core-control-plane/schema-view';
import type {
  IntrospectSchemaResult,
  SchemaVerificationNode,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { CliErrorConflict, CliErrorEnvelope } from './cli-errors';
import { getLongDescription } from './command-helpers';
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

  // Convert absolute paths to relative paths from cwd
  const jsonPath = relative(process.cwd(), result.files.json);
  const dtsPath = relative(process.cwd(), result.files.dts);

  lines.push(`${prefix}✔ Emitted contract.json → ${jsonPath}`);
  lines.push(`${prefix}✔ Emitted contract.d.ts → ${dtsPath}`);
  lines.push(`${prefix}  storageHash: ${result.storageHash}`);
  if (result.executionHash) {
    lines.push(`${prefix}  executionHash: ${result.executionHash}`);
  }
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
    storageHash: result.storageHash,
    ...ifDefined('executionHash', result.executionHash),
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
  // Show conflicts list if present (always show a short list; show full list when verbose)
  if (error.meta?.['conflicts']) {
    const conflicts = error.meta['conflicts'] as readonly CliErrorConflict[];
    if (conflicts.length > 0) {
      const maxToShow = isVerbose(flags, 1) ? conflicts.length : Math.min(3, conflicts.length);
      const header = isVerbose(flags, 1)
        ? '  Conflicts:'
        : `  Conflicts (showing ${maxToShow} of ${conflicts.length}):`;
      lines.push(`${prefix}${formatDimText(header)}`);
      for (const conflict of conflicts.slice(0, maxToShow)) {
        lines.push(`${prefix}${formatDimText(`    - [${conflict.kind}] ${conflict.summary}`)}`);
      }
      if (!isVerbose(flags, 1) && conflicts.length > maxToShow) {
        lines.push(`${prefix}${formatDimText('  Re-run with -v/--verbose to see all conflicts')}`);
      }
    }
  }
  // Show issues list if present (always show a short list; show full list when verbose)
  if (error.meta?.['issues']) {
    const issues = error.meta['issues'] as readonly { kind?: string; message?: string }[];
    if (issues.length > 0) {
      const maxToShow = isVerbose(flags, 1) ? issues.length : Math.min(3, issues.length);
      const header = isVerbose(flags, 1)
        ? '  Issues:'
        : `  Issues (showing ${maxToShow} of ${issues.length}):`;
      lines.push(`${prefix}${formatDimText(header)}`);
      for (const issue of issues.slice(0, maxToShow)) {
        const kind = issue.kind ?? 'issue';
        const message = issue.message ?? '';
        lines.push(`${prefix}${formatDimText(`    - [${kind}] ${message}`)}`);
      }
      if (!isVerbose(flags, 1) && issues.length > maxToShow) {
        lines.push(`${prefix}${formatDimText('  Re-run with -v/--verbose to see all issues')}`);
      }
    }
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
    lines.push(`${prefix}${formatDimText(`  storageHash: ${result.contract.storageHash}`)}`);
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

/**
 * Formats JSON output for database introspection.
 */
export function formatIntrospectJson(result: IntrospectSchemaResult<unknown>): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Renders a schema tree structure from CoreSchemaView.
 * Matches the style of renderSchemaVerificationTree for consistency.
 */
function renderSchemaTree(
  node: SchemaTreeNode,
  flags: GlobalFlags,
  options: {
    readonly isLast: boolean;
    readonly prefix: string;
    readonly useColor: boolean;
    readonly formatDimText: (text: string) => string;
    readonly isRoot?: boolean;
  },
): string[] {
  const { isLast, prefix, useColor, formatDimText, isRoot = false } = options;
  const lines: string[] = [];

  // Format node label with color based on kind (matching schema-verify style)
  let formattedLabel: string = node.label;

  if (useColor) {
    switch (node.kind) {
      case 'root':
        formattedLabel = bold(node.label);
        break;
      case 'entity': {
        // Parse "table tableName" format - color "table" dim, tableName cyan
        const tableMatch = node.label.match(/^table\s+(.+)$/);
        if (tableMatch?.[1]) {
          const tableName = tableMatch[1];
          formattedLabel = `${dim('table')} ${cyan(tableName)}`;
        } else {
          // Fallback: color entire label with cyan
          formattedLabel = cyan(node.label);
        }
        break;
      }
      case 'collection': {
        // "columns" grouping node - dim the label
        formattedLabel = dim(node.label);
        break;
      }
      case 'field': {
        // Parse column name format: "columnName: typeDisplay (nullability)"
        // Color code: column name (cyan), type (default), nullability (dim)
        const columnMatch = node.label.match(/^([^:]+):\s*(.+)$/);
        if (columnMatch?.[1] && columnMatch[2]) {
          const columnName = columnMatch[1];
          const rest = columnMatch[2];
          // Parse rest: "typeDisplay (nullability)"
          const typeMatch = rest.match(/^([^\s(]+)\s*(\([^)]+\))$/);
          if (typeMatch?.[1] && typeMatch[2]) {
            const typeDisplay = typeMatch[1];
            const nullability = typeMatch[2];
            formattedLabel = `${cyan(columnName)}: ${typeDisplay} ${dim(nullability)}`;
          } else {
            // Fallback if format doesn't match
            formattedLabel = `${cyan(columnName)}: ${rest}`;
          }
        } else {
          formattedLabel = node.label;
        }
        break;
      }
      case 'index': {
        // Parse index/unique constraint/primary key formats
        // "primary key: columnName" -> dim "primary key", cyan columnName
        const pkMatch = node.label.match(/^primary key:\s*(.+)$/);
        if (pkMatch?.[1]) {
          const columnNames = pkMatch[1];
          formattedLabel = `${dim('primary key')}: ${cyan(columnNames)}`;
        } else {
          // "unique name" -> dim "unique", cyan "name"
          const uniqueMatch = node.label.match(/^unique\s+(.+)$/);
          if (uniqueMatch?.[1]) {
            const name = uniqueMatch[1];
            formattedLabel = `${dim('unique')} ${cyan(name)}`;
          } else {
            // "index name" or "unique index name" -> dim label prefix, cyan name
            const indexMatch = node.label.match(/^(unique\s+)?index\s+(.+)$/);
            if (indexMatch?.[2]) {
              const prefix = indexMatch[1] ? `${dim('unique')} ` : '';
              const name = indexMatch[2];
              formattedLabel = `${prefix}${dim('index')} ${cyan(name)}`;
            } else {
              formattedLabel = dim(node.label);
            }
          }
        }
        break;
      }
      case 'extension': {
        // Parse extension message formats similar to schema-verify
        // "extensionName extension is enabled" -> cyan extensionName, dim rest
        const extMatch = node.label.match(/^([^\s]+)\s+(extension is enabled)$/);
        if (extMatch?.[1] && extMatch[2]) {
          const extName = extMatch[1];
          const rest = extMatch[2];
          formattedLabel = `${cyan(extName)} ${dim(rest)}`;
        } else {
          // Fallback: color entire label with magenta
          formattedLabel = magenta(node.label);
        }
        break;
      }
      default:
        formattedLabel = node.label;
        break;
    }
  }

  // Root node renders without tree characters or │ prefix
  if (isRoot) {
    lines.push(formattedLabel);
  } else {
    // Determine tree character for this node
    const treeChar = isLast ? '└' : '├';
    const treePrefix = `${prefix}${formatDimText(treeChar)}─ `;
    // Root's direct children don't have │ prefix, other nodes do
    // But if prefix already contains │ (for nested children), don't add another
    const isRootChild = prefix === '';
    // Check if prefix already contains │ (strip ANSI codes for comparison)
    const prefixWithoutAnsi = stripAnsi(prefix);
    const prefixHasVerticalBar = prefixWithoutAnsi.includes('│');
    if (isRootChild) {
      lines.push(`${treePrefix}${formattedLabel}`);
    } else if (prefixHasVerticalBar) {
      // Prefix already has │, so just use treePrefix directly
      lines.push(`${treePrefix}${formattedLabel}`);
    } else {
      lines.push(`${formatDimText('│')} ${treePrefix}${formattedLabel}`);
    }
  }

  // Render children if present
  if (node.children && node.children.length > 0) {
    // For root node, children start with no prefix (they'll add their own tree characters)
    // For other nodes, calculate child prefix based on whether this is last
    const childPrefix = isRoot ? '' : isLast ? `${prefix}   ` : `${prefix}${formatDimText('│')}  `;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (!child) continue;
      const isLastChild = i === node.children.length - 1;
      const childLines = renderSchemaTree(child, flags, {
        isLast: isLastChild,
        prefix: childPrefix,
        useColor,
        formatDimText,
        isRoot: false,
      });
      lines.push(...childLines);
    }
  }

  return lines;
}

/**
 * Formats human-readable output for database introspection.
 */
export function formatIntrospectOutput(
  result: IntrospectSchemaResult<unknown>,
  schemaView: CoreSchemaView | undefined,
  flags: GlobalFlags,
): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];
  const prefix = createPrefix(flags);
  const useColor = flags.color !== false;
  const formatDimText = (text: string) => formatDim(useColor, text);

  if (schemaView) {
    // Render tree structure - root node is special (no tree characters)
    const treeLines = renderSchemaTree(schemaView.root, flags, {
      isLast: true,
      prefix: '',
      useColor,
      formatDimText,
      isRoot: true,
    });
    // Apply prefix (for timestamps) to each tree line
    const prefixedTreeLines = treeLines.map((line) => `${prefix}${line}`);
    lines.push(...prefixedTreeLines);
  } else {
    // Fallback: print summary when toSchemaView is not available
    lines.push(`${prefix}✔ ${result.summary}`);
    if (isVerbose(flags, 1)) {
      lines.push(`${prefix}  Target: ${result.target.familyId}/${result.target.id}`);
      if (result.meta?.dbUrl) {
        lines.push(`${prefix}  Database: ${result.meta.dbUrl}`);
      }
    }
  }

  // Add timings in verbose mode
  if (isVerbose(flags, 1)) {
    lines.push(`${prefix}${formatDimText(`  Total time: ${result.timings.total}ms`)}`);
  }

  return lines.join('\n');
}

/**
 * Renders a schema verification tree structure from SchemaVerificationNode.
 * Similar to renderSchemaTree but for verification nodes with status-based colors and glyphs.
 */
function renderSchemaVerificationTree(
  node: SchemaVerificationNode,
  flags: GlobalFlags,
  options: {
    readonly isLast: boolean;
    readonly prefix: string;
    readonly useColor: boolean;
    readonly formatDimText: (text: string) => string;
    readonly isRoot?: boolean;
  },
): string[] {
  const { isLast, prefix, useColor, formatDimText, isRoot = false } = options;
  const lines: string[] = [];

  // Format status glyph and color based on status
  let statusGlyph = '';
  let statusColor: (text: string) => string = (text) => text;
  if (useColor) {
    switch (node.status) {
      case 'pass':
        statusGlyph = '✔';
        statusColor = green;
        break;
      case 'warn':
        statusGlyph = '⚠';
        statusColor = (text) => (useColor ? yellow(text) : text);
        break;
      case 'fail':
        statusGlyph = '✖';
        statusColor = red;
        break;
    }
  } else {
    switch (node.status) {
      case 'pass':
        statusGlyph = '✔';
        break;
      case 'warn':
        statusGlyph = '⚠';
        break;
      case 'fail':
        statusGlyph = '✖';
        break;
    }
  }

  // Format node label with color based on kind
  // For column nodes, we need to parse the name to color code different parts
  let labelColor: (text: string) => string = (text) => text;
  let formattedLabel: string = node.name;

  if (useColor) {
    switch (node.kind) {
      case 'contract':
      case 'schema':
        labelColor = bold;
        formattedLabel = labelColor(node.name);
        break;
      case 'table': {
        // Parse "table tableName" format - color "table" dim, tableName cyan
        const tableMatch = node.name.match(/^table\s+(.+)$/);
        if (tableMatch?.[1]) {
          const tableName = tableMatch[1];
          formattedLabel = `${dim('table')} ${cyan(tableName)}`;
        } else {
          formattedLabel = dim(node.name);
        }
        break;
      }
      case 'columns':
        labelColor = dim;
        formattedLabel = labelColor(node.name);
        break;
      case 'column': {
        // Parse column name format: "columnName: contractType → nativeType (nullability)"
        // Color code: column name (cyan), contract type (default), native type (dim), nullability (dim)
        const columnMatch = node.name.match(/^([^:]+):\s*(.+)$/);
        if (columnMatch?.[1] && columnMatch[2]) {
          const columnName = columnMatch[1];
          const rest = columnMatch[2];
          // Parse rest: "contractType → nativeType (nullability)"
          // Match contract type (can contain /, @, etc.), arrow, native type, then nullability in parentheses
          const typeMatch = rest.match(/^([^\s→]+)\s*→\s*([^\s(]+)\s*(\([^)]+\))$/);
          if (typeMatch?.[1] && typeMatch[2] && typeMatch[3]) {
            const contractType = typeMatch[1];
            const nativeType = typeMatch[2];
            const nullability = typeMatch[3];
            formattedLabel = `${cyan(columnName)}: ${contractType} → ${dim(nativeType)} ${dim(nullability)}`;
          } else {
            // Fallback if format doesn't match (e.g., no native type or no nullability)
            formattedLabel = `${cyan(columnName)}: ${rest}`;
          }
        } else {
          formattedLabel = node.name;
        }
        break;
      }
      case 'type':
      case 'nullability':
        labelColor = (text) => text; // Default color
        formattedLabel = labelColor(node.name);
        break;
      case 'primaryKey': {
        // Parse "primary key: columnName" format - color "primary key" dim, columnName cyan
        const pkMatch = node.name.match(/^primary key:\s*(.+)$/);
        if (pkMatch?.[1]) {
          const columnNames = pkMatch[1];
          formattedLabel = `${dim('primary key')}: ${cyan(columnNames)}`;
        } else {
          formattedLabel = dim(node.name);
        }
        break;
      }
      case 'foreignKey':
      case 'unique':
      case 'index':
        labelColor = dim;
        formattedLabel = labelColor(node.name);
        break;
      case 'extension': {
        // Parse specific extension message formats
        // "database is postgres" -> dim "database is", cyan "postgres"
        const dbMatch = node.name.match(/^database is\s+(.+)$/);
        if (dbMatch?.[1]) {
          const dbName = dbMatch[1];
          formattedLabel = `${dim('database is')} ${cyan(dbName)}`;
        } else {
          // "vector extension is enabled" -> dim everything except extension name
          // Match pattern: "extensionName extension is enabled"
          const extMatch = node.name.match(/^([^\s]+)\s+(extension is enabled)$/);
          if (extMatch?.[1] && extMatch[2]) {
            const extName = extMatch[1];
            const rest = extMatch[2];
            formattedLabel = `${cyan(extName)} ${dim(rest)}`;
          } else {
            // Fallback: color entire name with magenta
            labelColor = magenta;
            formattedLabel = labelColor(node.name);
          }
        }
        break;
      }
      default:
        formattedLabel = node.name;
        break;
    }
  } else {
    formattedLabel = node.name;
  }

  const statusGlyphColored = statusColor(statusGlyph);

  // Build the label with optional message for failure/warn nodes
  let nodeLabel = formattedLabel;
  if (
    (node.status === 'fail' || node.status === 'warn') &&
    node.message &&
    node.message.length > 0
  ) {
    // Always show message for failure/warn nodes - it provides crucial context
    // For parent nodes, the message summarizes child failures
    // For leaf nodes, the message explains the specific issue
    const messageText = formatDimText(`(${node.message})`);
    nodeLabel = `${formattedLabel} ${messageText}`;
  }

  // Root node renders without tree characters or │ prefix
  if (isRoot) {
    lines.push(`${statusGlyphColored} ${nodeLabel}`);
  } else {
    // Determine tree character for this node
    const treeChar = isLast ? '└' : '├';
    const treePrefix = `${prefix}${formatDimText(treeChar)}─ `;
    // Root's direct children don't have │ prefix, other nodes do
    const isRootChild = prefix === '';
    // Check if prefix already contains │ (strip ANSI codes for comparison)
    const prefixWithoutAnsi = stripAnsi(prefix);
    const prefixHasVerticalBar = prefixWithoutAnsi.includes('│');
    if (isRootChild) {
      lines.push(`${treePrefix}${statusGlyphColored} ${nodeLabel}`);
    } else if (prefixHasVerticalBar) {
      // Prefix already has │, so just use treePrefix directly
      lines.push(`${treePrefix}${statusGlyphColored} ${nodeLabel}`);
    } else {
      lines.push(`${formatDimText('│')} ${treePrefix}${statusGlyphColored} ${nodeLabel}`);
    }
  }

  // Render children if present
  if (node.children && node.children.length > 0) {
    // For root node, children start with no prefix (they'll add their own tree characters)
    // For other nodes, calculate child prefix based on whether this is last
    const childPrefix = isRoot ? '' : isLast ? `${prefix}   ` : `${prefix}${formatDimText('│')}  `;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (!child) continue;
      const isLastChild = i === node.children.length - 1;
      const childLines = renderSchemaVerificationTree(child, flags, {
        isLast: isLastChild,
        prefix: childPrefix,
        useColor,
        formatDimText,
        isRoot: false,
      });
      lines.push(...childLines);
    }
  }

  return lines;
}

/**
 * Formats human-readable output for database schema verification.
 */
export function formatSchemaVerifyOutput(
  result: VerifyDatabaseSchemaResult,
  flags: GlobalFlags,
): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];
  const prefix = createPrefix(flags);
  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatRed = createColorFormatter(useColor, red);
  const formatDimText = (text: string) => formatDim(useColor, text);

  // Render verification tree first
  const treeLines = renderSchemaVerificationTree(result.schema.root, flags, {
    isLast: true,
    prefix: '',
    useColor,
    formatDimText,
    isRoot: true,
  });
  // Apply prefix (for timestamps) to each tree line
  const prefixedTreeLines = treeLines.map((line) => `${prefix}${line}`);
  lines.push(...prefixedTreeLines);

  // Add counts and timings in verbose mode
  if (isVerbose(flags, 1)) {
    lines.push(`${prefix}${formatDimText(`  Total time: ${result.timings.total}ms`)}`);
    lines.push(
      `${prefix}${formatDimText(`  pass=${result.schema.counts.pass} warn=${result.schema.counts.warn} fail=${result.schema.counts.fail}`)}`,
    );
  }

  // Blank line before summary
  lines.push('');

  // Summary line at the end: summary with status glyph
  if (result.ok) {
    lines.push(`${prefix}${formatGreen('✔')} ${result.summary}`);
  } else {
    const codeText = result.code ? ` (${result.code})` : '';
    lines.push(`${prefix}${formatRed('✖')} ${result.summary}${codeText}`);
  }

  return lines.join('\n');
}

/**
 * Formats JSON output for database schema verification.
 */
export function formatSchemaVerifyJson(result: VerifyDatabaseSchemaResult): string {
  return JSON.stringify(result, null, 2);
}

// ============================================================================
// Sign Output Formatters
// ============================================================================

/**
 * Formats human-readable output for database sign.
 */
export function formatSignOutput(result: SignDatabaseResult, flags: GlobalFlags): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];
  const prefix = createPrefix(flags);
  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatDimText = (text: string) => formatDim(useColor, text);

  if (result.ok) {
    // Main success message in white (not dimmed)
    lines.push(`${prefix}${formatGreen('✔')} Database signed`);

    // Show from -> to hashes with clear labels
    const previousHash = result.marker.previous?.storageHash ?? 'none';
    const currentHash = result.contract.storageHash;

    lines.push(`${prefix}${formatDimText(`  from: ${previousHash}`)}`);
    lines.push(`${prefix}${formatDimText(`  to:   ${currentHash}`)}`);

    if (isVerbose(flags, 1)) {
      if (result.contract.profileHash) {
        lines.push(`${prefix}${formatDimText(`  profileHash: ${result.contract.profileHash}`)}`);
      }
      if (result.marker.previous?.profileHash) {
        lines.push(
          `${prefix}${formatDimText(`  previous profileHash: ${result.marker.previous.profileHash}`)}`,
        );
      }
      lines.push(`${prefix}${formatDimText(`  Total time: ${result.timings.total}ms`)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats JSON output for database sign.
 */
export function formatSignJson(result: SignDatabaseResult): string {
  return JSON.stringify(result, null, 2);
}

// ============================================================================
// Migration Command Output Formatters (shared by db init and db update)
// ============================================================================

/**
 * Shared CLI output type for migration commands (db init, db update).
 */
export interface MigrationCommandResult {
  readonly ok: boolean;
  readonly mode: 'plan' | 'apply';
  readonly plan?: {
    readonly targetId: string;
    readonly destination: {
      readonly storageHash: string;
      readonly profileHash?: string;
    };
    readonly operations: readonly {
      readonly id: string;
      readonly label: string;
      readonly operationClass: string;
    }[];
  };
  /** Origin contract identity (present in db-update results, absent in db-init). */
  readonly origin?: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly execution?: {
    readonly operationsPlanned: number;
    readonly operationsExecuted: number;
  };
  readonly marker?: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  readonly summary: string;
  readonly timings: {
    readonly total: number;
  };
}

/**
 * Formats human-readable output for db init plan mode.
 */
export function formatMigrationPlanOutput(
  result: MigrationCommandResult,
  flags: GlobalFlags,
): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];
  const prefix = createPrefix(flags);
  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatDimText = (text: string) => formatDim(useColor, text);

  // Plan summary
  const operationCount = result.plan?.operations.length ?? 0;
  lines.push(`${prefix}${formatGreen('✔')} Planned ${operationCount} operation(s)`);

  // Show operations tree
  if (result.plan?.operations && result.plan.operations.length > 0) {
    lines.push(`${prefix}${formatDimText('│')}`);
    for (let i = 0; i < result.plan.operations.length; i++) {
      const op = result.plan.operations[i];
      if (!op) continue;
      const isLast = i === result.plan.operations.length - 1;
      const treeChar = isLast ? '└' : '├';
      const opClass = formatDimText(`[${op.operationClass}]`);
      lines.push(`${prefix}${formatDimText(treeChar)}─ ${op.label} ${opClass}`);
    }
  }

  // Destination hash
  if (result.plan?.destination) {
    lines.push(`${prefix}`);
    lines.push(
      `${prefix}${formatDimText(`Destination hash: ${result.plan.destination.storageHash}`)}`,
    );
  }

  // Timings in verbose mode
  if (isVerbose(flags, 1)) {
    lines.push(`${prefix}${formatDimText(`Total time: ${result.timings.total}ms`)}`);
  }

  // Note about dry run
  lines.push(`${prefix}`);
  lines.push(`${prefix}${formatDimText('This is a dry run. No changes were applied.')}`);
  lines.push(`${prefix}${formatDimText('Run without --plan to apply changes.')}`);

  return lines.join('\n');
}

/**
 * Formats human-readable output for db init apply mode.
 */
export function formatMigrationApplyOutput(
  result: MigrationCommandResult,
  flags: GlobalFlags,
): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];
  const prefix = createPrefix(flags);
  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatDimText = (text: string) => formatDim(useColor, text);

  if (result.ok) {
    // Success summary
    const executed = result.execution?.operationsExecuted ?? 0;
    lines.push(`${prefix}${formatGreen('✔')} Applied ${executed} operation(s)`);

    // Marker info
    if (result.marker) {
      lines.push(`${prefix}${formatDimText(`  Marker written: ${result.marker.storageHash}`)}`);
      if (result.marker.profileHash) {
        lines.push(`${prefix}${formatDimText(`  Profile hash: ${result.marker.profileHash}`)}`);
      }
    }

    // Timings in verbose mode
    if (isVerbose(flags, 1)) {
      lines.push(`${prefix}${formatDimText(`  Total time: ${result.timings.total}ms`)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats JSON output for db init command.
 */
export function formatMigrationJson(result: MigrationCommandResult): string {
  return JSON.stringify(result, null, 2);
}

// ============================================================================
// Styled Output Formatters
// ============================================================================

/**
 * Fixed width for left column in help output.
 */
const LEFT_COLUMN_WIDTH = 20;

/**
 * Minimum width for right column wrapping in help output.
 */
const RIGHT_COLUMN_MIN_WIDTH = 40;

/**
 * Maximum width for right column wrapping in help output (when terminal is wide enough).
 */
const RIGHT_COLUMN_MAX_WIDTH = 90;

/**
 * Gets the terminal width, or returns a default if not available.
 */
function getTerminalWidth(): number {
  // process.stdout.columns may be undefined in non-TTY environments
  const terminalWidth = process.stdout.columns;
  // Default to 80 if terminal width is not available, but allow override via env var
  const defaultWidth = Number.parseInt(process.env['CLI_WIDTH'] || '80', 10);
  return terminalWidth || defaultWidth;
}

/**
 * Calculates the available width for the right column based on terminal width.
 * Format: "│ " (2) + left column (20) + "  " (2) + right column = total
 * So: right column = terminal width - 2 - 20 - 2 = terminal width - 24
 */
function calculateRightColumnWidth(): number {
  const terminalWidth = getTerminalWidth();
  const availableWidth = terminalWidth - 2 - LEFT_COLUMN_WIDTH - 2; // Subtract separators and left column
  // Ensure minimum width, but don't exceed maximum
  return Math.max(RIGHT_COLUMN_MIN_WIDTH, Math.min(availableWidth, RIGHT_COLUMN_MAX_WIDTH));
}

/**
 * Creates an arrow segment badge with green background and white text.
 * Body: green background with white "prisma-next" text
 * Tip: dark grey arrow pointing right (Powerline separator)
 */
function createPrismaNextBadge(useColor: boolean): string {
  if (!useColor) {
    return 'prisma-next';
  }
  // Body: green background with white text
  const text = ' prisma-next ';
  const body = bgGreen(bold(text));

  // Use Powerline separator (U+E0B0) which creates the arrow transition effect
  const separator = '\u{E0B0}';
  const tip = green(separator); // Dark grey arrow tip

  return `${body}${tip}`;
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
    return `${options.brand} ${options.operation} → ${options.intent}`;
  }
  return `${options.brand} ${options.intent}`;
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
 * Pads text to a fixed width, accounting for ANSI escape codes.
 * Uses string-width to measure the actual display width.
 */
function padToFixedWidth(text: string, width: number): string {
  const actualWidth = stringWidth(text);
  const padding = Math.max(0, width - actualWidth);
  return text + ' '.repeat(padding);
}

/**
 * Wraps text to fit within a specified width using wrap-ansi.
 * Preserves ANSI escape codes and breaks at word boundaries.
 */
function wrapTextAnsi(text: string, width: number): string[] {
  const wrapped = wrapAnsi(text, width, { hard: false, trim: true });
  return wrapped.split('\n');
}

/**
 * Formats a default value as "default: <value>" with dimming.
 */
function formatDefaultValue(value: unknown, useColor: boolean): string {
  const valueStr = String(value);
  const defaultText = `default: ${valueStr}`;
  return useColor ? dim(defaultText) : defaultText;
}

/**
 * Renders a command tree structure.
 * Handles both single-level (subcommands of a command) and multi-level (top-level commands with subcommands) trees.
 */
function renderCommandTree(options: {
  readonly commands: readonly Command[];
  readonly useColor: boolean;
  readonly formatDimText: (text: string) => string;
  readonly hasItemsAfter: boolean;
  readonly continuationPrefix?: string;
}): string[] {
  const { commands, useColor, formatDimText, hasItemsAfter, continuationPrefix } = options;
  const lines: string[] = [];

  if (commands.length === 0) {
    return lines;
  }

  // Format each command
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd) continue;

    const subcommands = cmd.commands.filter((subcmd) => !subcmd.name().startsWith('_'));
    const isLastCommand = i === commands.length - 1;

    if (subcommands.length > 0) {
      // Command with subcommands - show command name, then tree-structured subcommands
      const prefix = isLastCommand && !hasItemsAfter ? formatDimText('└') : formatDimText('├');
      // For top-level command, pad name to fixed width (accounting for "│ ├─ " = 5 chars)
      const treePrefix = `${prefix}─ `;
      const treePrefixWidth = stringWidth(stripAnsi(treePrefix));
      const remainingWidth = LEFT_COLUMN_WIDTH - treePrefixWidth;
      const commandNamePadded = padToFixedWidth(cmd.name(), remainingWidth);
      const commandNameColored = useColor ? cyan(commandNamePadded) : commandNamePadded;
      lines.push(`${formatDimText('│')} ${treePrefix}${commandNameColored}`);

      for (let j = 0; j < subcommands.length; j++) {
        const subcmd = subcommands[j];
        if (!subcmd) continue;

        const isLastSubcommand = j === subcommands.length - 1;
        const shortDescription = subcmd.description() || '';

        // Use tree characters: └─ for last subcommand, ├─ for others
        const treeChar = isLastSubcommand ? '└' : '├';
        const continuation =
          continuationPrefix ??
          (isLastCommand && isLastSubcommand && !hasItemsAfter ? ' ' : formatDimText('│'));
        // For subcommands, account for "│ │  └─ " = 7 chars (or "│   └─ " = 6 chars if continuation is space)
        const continuationStr = continuation === ' ' ? ' ' : continuation;
        const subTreePrefix = `${continuationStr}  ${formatDimText(treeChar)}─ `;
        const subTreePrefixWidth = stringWidth(stripAnsi(subTreePrefix));
        const subRemainingWidth = LEFT_COLUMN_WIDTH - subTreePrefixWidth;
        const subcommandNamePadded = padToFixedWidth(subcmd.name(), subRemainingWidth);
        const subcommandNameColored = useColor ? cyan(subcommandNamePadded) : subcommandNamePadded;
        lines.push(
          `${formatDimText('│')} ${subTreePrefix}${subcommandNameColored}  ${shortDescription}`,
        );
      }
    } else {
      // Standalone command - show command name and description on same line
      const prefix = isLastCommand && !hasItemsAfter ? formatDimText('└') : formatDimText('├');
      const treePrefix = `${prefix}─ `;
      const treePrefixWidth = stringWidth(stripAnsi(treePrefix));
      const remainingWidth = LEFT_COLUMN_WIDTH - treePrefixWidth;
      const commandNamePadded = padToFixedWidth(cmd.name(), remainingWidth);
      const commandNameColored = useColor ? cyan(commandNamePadded) : commandNamePadded;
      const shortDescription = cmd.description() || '';
      lines.push(`${formatDimText('│')} ${treePrefix}${commandNameColored}  ${shortDescription}`);
    }
  }

  return lines;
}

/**
 * Formats multiline description with "Prisma Next" in green.
 * Wraps at the same right-hand boundary as the right column.
 * The right edge is defined by: left column (20) + gap (2) + right column (90) = 112 characters total.
 * Since the description line starts with "│ " (2 chars), the text wraps at 112 - 2 = 110 characters.
 */
function formatMultilineDescription(options: {
  readonly descriptionLines: readonly string[];
  readonly useColor: boolean;
  readonly formatDimText: (text: string) => string;
}): string[] {
  const lines: string[] = [];
  const formatGreen = (text: string) => (options.useColor ? green(text) : text);

  // Calculate wrap width to align with right edge of right column
  // Format: "│ " (2) + left column (20) + "  " (2) + right column = total
  // Description line has "│ " prefix (2 chars), so text wraps at total - 2
  const rightColumnWidth = calculateRightColumnWidth();
  const totalWidth = 2 + LEFT_COLUMN_WIDTH + 2 + rightColumnWidth;
  const wrapWidth = totalWidth - 2; // Subtract "│ " prefix

  for (const descLine of options.descriptionLines) {
    // Replace "Prisma Next" with green version if present
    const formattedLine = descLine.replace(/Prisma Next/g, (match) => formatGreen(match));

    // Wrap the line at the same right edge as the right column
    const wrappedLines = wrapTextAnsi(formattedLine, wrapWidth);
    for (const wrappedLine of wrappedLines) {
      lines.push(`${options.formatDimText('│')} ${wrappedLine}`);
    }
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
  // Use full command path (e.g., "contract emit" not just "emit")
  const operation = useColor ? bold(options.command) : options.command;
  const intent = formatDimText(options.description);
  lines.push(formatHeaderLine({ brand, operation, intent }));
  lines.push(formatDimText('│')); // Vertical line separator between command and params

  // Format details using fixed left column width (same style as help text options)
  for (const detail of options.details) {
    // Add colon to label, then pad to fixed width using padToFixedWidth for ANSI-aware padding
    const labelWithColon = `${detail.label}:`;
    const labelPadded = padToFixedWidth(labelWithColon, LEFT_COLUMN_WIDTH);
    const labelColored = useColor ? cyan(labelPadded) : labelPadded;
    lines.push(`${formatDimText('│')} ${labelColored}  ${detail.value}`);
  }

  // Add "Read more" URL if present (same style as help text)
  if (options.url) {
    lines.push(formatDimText('│')); // Separator line before "Read more"
    lines.push(
      formatReadMoreLine({
        url: options.url,
        maxLabelWidth: LEFT_COLUMN_WIDTH,
        useColor,
        formatDimText,
      }),
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
  return `${formatGreen('✔')} Success`;
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
    'db update': 'https://pris.ly/db-update',
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
  const shortDescription = command.description() || '';
  const longDescription = getLongDescription(command);

  // Header: "prisma-next <full-command-path> <short-description>"
  const brand = createPrismaNextBadge(useColor);
  const operation = useColor ? bold(commandPath) : commandPath;
  const intent = formatDimText(shortDescription);
  lines.push(formatHeaderLine({ brand, operation, intent }));
  lines.push(formatDimText('│')); // Vertical line separator between command and params

  // Extract options and format them
  const optionsList = command.options.map((opt) => {
    const flags = opt.flags;
    const description = opt.description || '';
    // Commander.js stores default value in defaultValue property
    const defaultValue = (opt as { defaultValue?: unknown }).defaultValue;
    return { flags, description, defaultValue };
  });

  // Extract subcommands if any
  const subcommands = command.commands.filter((cmd) => !cmd.name().startsWith('_'));

  // Format subcommands as a tree if present
  if (subcommands.length > 0) {
    const hasItemsAfter = optionsList.length > 0;
    const treeLines = renderCommandTree({
      commands: subcommands,
      useColor,
      formatDimText,
      hasItemsAfter,
    });
    lines.push(...treeLines);
  }

  // Add separator between subcommands and options if both exist
  if (subcommands.length > 0 && optionsList.length > 0) {
    lines.push(formatDimText('│'));
  }

  // Format options with fixed width, wrapping, and default values
  if (optionsList.length > 0) {
    for (const opt of optionsList) {
      // Format flag with fixed 30-char width
      const flagsPadded = padToFixedWidth(opt.flags, LEFT_COLUMN_WIDTH);
      let flagsColored = flagsPadded;
      if (useColor) {
        // Color placeholders in magenta, then wrap in cyan
        flagsColored = flagsPadded.replace(/(<[^>]+>)/g, (match: string) => magenta(match));
        flagsColored = cyan(flagsColored);
      }

      // Wrap description based on terminal width
      const rightColumnWidth = calculateRightColumnWidth();
      const wrappedDescription = wrapTextAnsi(opt.description, rightColumnWidth);

      // First line: flag + first line of description
      lines.push(`${formatDimText('│')} ${flagsColored}  ${wrappedDescription[0] || ''}`);

      // Continuation lines: empty label (30 spaces) + wrapped lines
      for (let i = 1; i < wrappedDescription.length; i++) {
        const emptyLabel = ' '.repeat(LEFT_COLUMN_WIDTH);
        lines.push(`${formatDimText('│')} ${emptyLabel}  ${wrappedDescription[i] || ''}`);
      }

      // Default value line (if present)
      if (opt.defaultValue !== undefined) {
        const emptyLabel = ' '.repeat(LEFT_COLUMN_WIDTH);
        const defaultText = formatDefaultValue(opt.defaultValue, useColor);
        lines.push(`${formatDimText('│')} ${emptyLabel}  ${defaultText}`);
      }
    }
  }

  // Add docs URL if available (with separator line before it)
  const docsUrl = getCommandDocsUrl(commandPath);
  if (docsUrl) {
    lines.push(formatDimText('│')); // Separator line between params and docs
    lines.push(
      formatReadMoreLine({
        url: docsUrl,
        maxLabelWidth: LEFT_COLUMN_WIDTH,
        useColor,
        formatDimText,
      }),
    );
  }

  // Multi-line description (if present) - shown after all other content
  if (longDescription) {
    lines.push(formatDimText('│'));
    const descriptionLines = longDescription.split('\n').filter((line) => line.trim().length > 0);
    lines.push(...formatMultilineDescription({ descriptionLines, useColor, formatDimText }));
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
  lines.push(formatDimText('│')); // Vertical line separator after header

  // Extract top-level commands (exclude hidden commands starting with '_' and the 'help' command)
  const topLevelCommands = program.commands.filter(
    (cmd) => !cmd.name().startsWith('_') && cmd.name() !== 'help',
  );

  // Extract global options (needed to determine if last command)
  const globalOptions = program.options.map((opt) => {
    const flags = opt.flags;
    const description = opt.description || '';
    // Commander.js stores default value in defaultValue property
    const defaultValue = (opt as { defaultValue?: unknown }).defaultValue;
    return { flags, description, defaultValue };
  });

  // Build command tree
  if (topLevelCommands.length > 0) {
    const hasItemsAfter = globalOptions.length > 0;
    const treeLines = renderCommandTree({
      commands: topLevelCommands,
      useColor,
      formatDimText,
      hasItemsAfter,
    });
    lines.push(...treeLines);
  }

  // Add separator between commands and options if both exist
  if (topLevelCommands.length > 0 && globalOptions.length > 0) {
    lines.push(formatDimText('│'));
  }

  // Format global options with fixed width, wrapping, and default values
  if (globalOptions.length > 0) {
    for (const opt of globalOptions) {
      // Format flag with fixed 30-char width
      const flagsPadded = padToFixedWidth(opt.flags, LEFT_COLUMN_WIDTH);
      let flagsColored = flagsPadded;
      if (useColor) {
        // Color placeholders in magenta, then wrap in cyan
        flagsColored = flagsPadded.replace(/(<[^>]+>)/g, (match: string) => magenta(match));
        flagsColored = cyan(flagsColored);
      }

      // Wrap description based on terminal width
      const rightColumnWidth = calculateRightColumnWidth();
      const wrappedDescription = wrapTextAnsi(opt.description, rightColumnWidth);

      // First line: flag + first line of description
      lines.push(`${formatDimText('│')} ${flagsColored}  ${wrappedDescription[0] || ''}`);

      // Continuation lines: empty label (30 spaces) + wrapped lines
      for (let i = 1; i < wrappedDescription.length; i++) {
        const emptyLabel = ' '.repeat(LEFT_COLUMN_WIDTH);
        lines.push(`${formatDimText('│')} ${emptyLabel}  ${wrappedDescription[i] || ''}`);
      }

      // Default value line (if present)
      if (opt.defaultValue !== undefined) {
        const emptyLabel = ' '.repeat(LEFT_COLUMN_WIDTH);
        const defaultText = formatDefaultValue(opt.defaultValue, useColor);
        lines.push(`${formatDimText('│')} ${emptyLabel}  ${defaultText}`);
      }
    }
  }

  // Multi-line description (white, not dimmed, with "Prisma Next" in green) - shown at bottom
  const formatGreen = (text: string) => (useColor ? green(text) : text);
  const descriptionLines = [
    `Use ${formatGreen('Prisma Next')} to define your data layer as a contract. Sign your database and application with the same contract to guarantee compatibility. Plan and apply migrations to safely evolve your schema.`,
  ];
  if (descriptionLines.length > 0) {
    lines.push(formatDimText('│')); // Separator line before description
    lines.push(...formatMultilineDescription({ descriptionLines, useColor, formatDimText }));
  }

  lines.push(formatDimText('└'));

  return `${lines.join('\n')}\n`;
}
