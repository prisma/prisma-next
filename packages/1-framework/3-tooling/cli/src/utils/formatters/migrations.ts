import type { OperationPreview } from '@prisma-next/framework-components/control';
import { green, yellow } from 'colorette';

import type { GlobalFlags } from '../global-flags';
import { createColorFormatter, formatDim, isVerbose } from './helpers';

/**
 * Render a single statement of an `OperationPreview` for the human-readable
 * preview block. SQL statements get a trailing `;` if missing — matches the
 * legacy `string[]`-based renderer byte-for-byte (per spec OQ-4). Other
 * languages (`'mongodb-shell'`) render verbatim.
 */
function renderPreviewStatement(text: string, language: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (language === 'sql') {
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
  }
  return trimmed;
}

/**
 * Choose the header label for a preview block. SQL-only previews keep the
 * legacy `DDL preview` label (preserves CLI byte-identity for SQL targets per
 * spec OQ-4); previews from any other family — or a mix that includes any
 * non-SQL language — use the family-agnostic `Operation preview` label.
 *
 * An empty `statements` array deliberately renders as `Operation preview`
 * rather than `DDL preview`: `Array.prototype.every` is vacuously true for
 * empty arrays, but we have no evidence the preview is SQL-only when no
 * statements are present, so the family-agnostic label is the safer default.
 */
export function previewBlockHeader(preview: OperationPreview): string {
  const allSql =
    preview.statements.length > 0 && preview.statements.every((s) => s.language === 'sql');
  return allSql ? 'DDL preview' : 'Operation preview';
}

// ============================================================================
// Migration Command Output Formatters (shared by db init and db update)
// ============================================================================

/**
 * Shared CLI output type for migration commands (db init, db update).
 */
export interface MigrationCommandResult {
  readonly ok: true;
  readonly mode: 'plan' | 'apply';
  readonly plan: {
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
    /**
     * Family-agnostic textual preview of the planned operations. Replaces the
     * previous `sql?: readonly string[]`. Consumers should read
     * `plan.preview?.statements`.
     */
    readonly preview?: OperationPreview;
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
 * Formats human-readable output for migration commands (db init, db update) in plan mode.
 */
export function formatMigrationPlanOutput(
  result: MigrationCommandResult,
  flags: GlobalFlags,
): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];

  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatDimText = (text: string) => formatDim(useColor, text);

  // Plan summary
  const operationCount = result.plan?.operations.length ?? 0;
  lines.push(`${formatGreen('✔')} Planned ${operationCount} operation(s)`);

  // Show operations tree
  if (result.plan?.operations && result.plan.operations.length > 0) {
    const formatYellow = createColorFormatter(useColor, yellow);
    lines.push(`${formatDimText('│')}`);
    for (let i = 0; i < result.plan.operations.length; i++) {
      const op = result.plan.operations[i];
      if (!op) continue;
      const isLast = i === result.plan.operations.length - 1;
      const treeChar = isLast ? '└' : '├';
      const opClassLabel =
        op.operationClass === 'destructive'
          ? formatYellow(`[${op.operationClass}]`)
          : formatDimText(`[${op.operationClass}]`);
      lines.push(`${formatDimText(treeChar)}─ ${op.label} ${opClassLabel}`);
    }

    const hasDestructive = result.plan.operations.some((op) => op.operationClass === 'destructive');
    if (hasDestructive) {
      lines.push('');
      lines.push(
        `${formatYellow('⚠')} This migration contains destructive operations that may cause data loss.`,
      );
    }
  }

  // Destination hash
  if (result.plan?.destination) {
    lines.push('');
    lines.push(`${formatDimText(`Destination hash: ${result.plan.destination.storageHash}`)}`);
  }

  // Statement preview (any family that implements OperationPreviewCapable)
  const preview = result.plan?.preview;
  if (preview) {
    lines.push('');
    lines.push(`${formatDimText(previewBlockHeader(preview))}`);
    if (preview.statements.length === 0) {
      lines.push(`${formatDimText('No operations.')}`);
    } else {
      lines.push('');
      for (const statement of preview.statements) {
        const rendered = renderPreviewStatement(statement.text, statement.language);
        if (rendered) {
          lines.push(rendered);
        }
      }
    }
  }

  // Timings in verbose mode
  if (isVerbose(flags, 1)) {
    lines.push(`${formatDimText(`Total time: ${result.timings.total}ms`)}`);
  }

  // Note about dry run
  lines.push('');
  lines.push(`${formatDimText('This is a dry run. No changes were applied.')}`);
  lines.push(`${formatDimText('Run without --dry-run to apply changes.')}`);

  return lines.join('\n');
}

export interface MigrationApplyCommandOutputResult {
  readonly migrationsApplied: number;
  readonly markerHash: string;
  readonly applied: readonly {
    readonly dirName: string;
    readonly operationsExecuted: number;
  }[];
  readonly summary: string;
  readonly timings?: {
    readonly total: number;
  };
}

export function formatMigrationApplyCommandOutput(
  result: MigrationApplyCommandOutputResult,
  flags: GlobalFlags,
): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];
  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatDimText = (text: string) => formatDim(useColor, text);

  if (result.migrationsApplied === 0) {
    lines.push(`${formatGreen('✔')} ${result.summary}`);
    lines.push(formatDimText(`  marker: ${result.markerHash}`));
    return lines.join('\n');
  }

  lines.push(`${formatGreen('✔')} ${result.summary}`);
  lines.push('');

  for (let i = 0; i < result.applied.length; i++) {
    const migration = result.applied[i]!;
    const isLast = i === result.applied.length - 1;
    const treeChar = isLast ? '└' : '├';
    lines.push(
      `${formatDimText(treeChar)}─ ${migration.dirName} ${formatDimText(`[${migration.operationsExecuted} op(s)]`)}`,
    );
  }

  lines.push('');
  lines.push(formatDimText(`marker: ${result.markerHash}`));

  if (isVerbose(flags, 1) && result.timings) {
    lines.push('');
    lines.push(formatDimText(`Total time: ${result.timings.total}ms`));
  }

  return lines.join('\n');
}

interface MigrationShowResult {
  readonly dirName: string;
  readonly dirPath: string;
  readonly from: string | null;
  readonly to: string;
  readonly migrationHash: string;
  readonly createdAt: string;
  readonly operations: readonly {
    readonly id: string;
    readonly label: string;
    readonly operationClass: string;
  }[];
  readonly preview: OperationPreview;
  readonly summary: string;
}

export function formatMigrationShowOutput(result: MigrationShowResult, flags: GlobalFlags): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];

  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatYellow = createColorFormatter(useColor, yellow);
  const formatDimText = (text: string) => formatDim(useColor, text);

  lines.push(`${formatGreen('✔')} ${result.dirName}`);
  lines.push(`${formatDimText(`  from: ${result.from ?? '(baseline)'}`)}`);
  lines.push(`${formatDimText(`  to:   ${result.to}`)}`);
  lines.push(`${formatDimText(`  migrationHash: ${result.migrationHash}`)}`);
  lines.push(`${formatDimText(`  created: ${result.createdAt}`)}`);

  lines.push('');
  lines.push(`${result.operations.length} operation(s)`);

  if (result.operations.length > 0) {
    lines.push(`${formatDimText('│')}`);
    for (let i = 0; i < result.operations.length; i++) {
      const op = result.operations[i]!;
      const isLast = i === result.operations.length - 1;
      const treeChar = isLast ? '└' : '├';
      const opClassLabel =
        op.operationClass === 'destructive'
          ? formatYellow(`[${op.operationClass}]`)
          : formatDimText(`[${op.operationClass}]`);
      lines.push(`${formatDimText(treeChar)}─ ${op.label} ${opClassLabel}`);
    }

    const hasDestructive = result.operations.some((op) => op.operationClass === 'destructive');
    if (hasDestructive) {
      lines.push('');
      lines.push(
        `${formatYellow('⚠')} This migration contains destructive operations that may cause data loss.`,
      );
    }
  }

  if (result.preview.statements.length > 0) {
    lines.push('');
    lines.push(`${formatDimText(previewBlockHeader(result.preview))}`);
    lines.push('');
    for (const statement of result.preview.statements) {
      const rendered = renderPreviewStatement(statement.text, statement.language);
      if (rendered) {
        lines.push(rendered);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Formats human-readable output for migration commands (db init, db update) in apply mode.
 */
export function formatMigrationApplyOutput(
  result: MigrationCommandResult,
  flags: GlobalFlags,
): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];

  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatDimText = (text: string) => formatDim(useColor, text);

  if (result.ok) {
    // Success summary
    const executed = result.execution?.operationsExecuted ?? 0;
    if (executed === 0) {
      lines.push(`${formatGreen('✔')} Database already matches contract`);
    } else {
      lines.push(`${formatGreen('✔')} Applied ${executed} operation(s)`);
    }

    // Marker info
    if (result.marker) {
      lines.push(`${formatDimText(`  Signature: ${result.marker.storageHash}`)}`);
      if (result.marker.profileHash) {
        lines.push(`${formatDimText(`  Profile hash: ${result.marker.profileHash}`)}`);
      }
    }

    // Timings in verbose mode
    if (isVerbose(flags, 1)) {
      lines.push(`${formatDimText(`  Total time: ${result.timings.total}ms`)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats JSON output for migration commands (db init, db update).
 */
export function formatMigrationJson(result: MigrationCommandResult): string {
  return JSON.stringify(result, null, 2);
}
