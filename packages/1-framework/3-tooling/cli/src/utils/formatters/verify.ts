import type { CoreSchemaView, SchemaTreeNode } from '@prisma-next/core-control-plane/schema-view';
import type {
  IntrospectSchemaResult,
  SchemaVerificationNode,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import { bold, cyan, dim, green, magenta, red, yellow } from 'colorette';
import type { GlobalFlags } from '../global-flags';
import { createColorFormatter, formatDim, isVerbose } from './helpers';

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

  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatRed = createColorFormatter(useColor, red);
  const formatDimText = (text: string) => formatDim(useColor, text);

  if (result.ok) {
    lines.push(`${formatGreen('✔')} ${result.summary}`);
    lines.push(`${formatDimText(`  storageHash: ${result.contract.storageHash}`)}`);
    if (result.contract.profileHash) {
      lines.push(`${formatDimText(`  profileHash: ${result.contract.profileHash}`)}`);
    }
  } else {
    lines.push(`${formatRed('✖')} ${result.summary} (${result.code})`);
  }

  if (isVerbose(flags, 1)) {
    if (result.codecCoverageSkipped) {
      lines.push(
        `${formatDimText('  Codec coverage check skipped (helper returned no supported types)')}`,
      );
    }
    lines.push(`${formatDimText(`  Total time: ${result.timings.total}ms`)}`);
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
              const indexPrefix = indexMatch[1] ? `${dim('unique')} ` : '';
              const name = indexMatch[2];
              formattedLabel = `${indexPrefix}${dim('index')} ${cyan(name)}`;
            } else {
              formattedLabel = dim(node.label);
            }
          }
        }
        break;
      }
      case 'dependency': {
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

  // Root node renders without tree characters or prefix
  if (isRoot) {
    lines.push(formattedLabel);
  } else {
    const treeChar = isLast ? '└' : '├';
    const treePrefix = `${formatDimText(treeChar)}─ `;
    lines.push(`${prefix}${treePrefix}${formattedLabel}`);
  }

  // Render children if present
  if (node.children && node.children.length > 0) {
    const childPrefix = isRoot ? '' : `${prefix}${isLast ? '   ' : `${formatDimText('│')}  `}`;
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
    lines.push(...treeLines);
  } else {
    // Fallback: print summary when toSchemaView is not available
    lines.push(`✔ ${result.summary}`);
    if (isVerbose(flags, 1)) {
      lines.push(`  Target: ${result.target.familyId}/${result.target.id}`);
      if (result.meta?.dbUrl) {
        lines.push(`  Database: ${result.meta.dbUrl}`);
      }
    }
  }

  // Add timings in verbose mode
  if (isVerbose(flags, 1)) {
    lines.push(`${formatDimText(`  Total time: ${result.timings.total}ms`)}`);
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
        // Parse column name format: "columnName: contractType -> nativeType (nullability)"
        // Color code: column name (cyan), contract type (default), native type (dim), nullability (dim)
        const columnMatch = node.name.match(/^([^:]+):\s*(.+)$/);
        if (columnMatch?.[1] && columnMatch[2]) {
          const columnName = columnMatch[1];
          const rest = columnMatch[2];
          // Parse rest: "contractType -> nativeType (nullability)"
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
      case 'dependency': {
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

  // Root node renders without tree characters or | prefix
  // Root node renders without tree characters or prefix
  if (isRoot) {
    lines.push(`${statusGlyphColored} ${nodeLabel}`);
  } else {
    const treeChar = isLast ? '└' : '├';
    const treePrefix = `${formatDimText(treeChar)}─ `;
    lines.push(`${prefix}${treePrefix}${statusGlyphColored} ${nodeLabel}`);
  }

  // Render children if present
  if (node.children && node.children.length > 0) {
    const childPrefix = isRoot ? '' : `${prefix}${isLast ? '   ' : `${formatDimText('│')}  `}`;
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
  lines.push(...treeLines);

  // Add counts and timings in verbose mode
  if (isVerbose(flags, 1)) {
    lines.push(`${formatDimText(`  Total time: ${result.timings.total}ms`)}`);
    lines.push(
      `${formatDimText(`  pass=${result.schema.counts.pass} warn=${result.schema.counts.warn} fail=${result.schema.counts.fail}`)}`,
    );
  }

  // Blank line before summary
  lines.push('');

  // Summary line at the end: summary with status glyph
  if (result.ok) {
    lines.push(`${formatGreen('✔')} ${result.summary}`);
  } else {
    const codeText = result.code ? ` (${result.code})` : '';
    lines.push(`${formatRed('✖')} ${result.summary}${codeText}`);
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

  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatDimText = (text: string) => formatDim(useColor, text);

  if (result.ok) {
    // Main success message in white (not dimmed)
    lines.push(`${formatGreen('✔')} Database signed`);

    // Show from -> to hashes with clear labels
    const previousHash = result.marker.previous?.storageHash ?? 'none';
    const currentHash = result.contract.storageHash;

    lines.push(`${formatDimText(`  from: ${previousHash}`)}`);
    lines.push(`${formatDimText(`  to:   ${currentHash}`)}`);

    if (isVerbose(flags, 1)) {
      if (result.contract.profileHash) {
        lines.push(`${formatDimText(`  profileHash: ${result.contract.profileHash}`)}`);
      }
      if (result.marker.previous?.profileHash) {
        lines.push(
          `${formatDimText(`  previous profileHash: ${result.marker.previous.profileHash}`)}`,
        );
      }
      lines.push(`${formatDimText(`  Total time: ${result.timings.total}ms`)}`);
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
