import { green, yellow } from 'colorette';

import type { GlobalFlags } from '../global-flags';
import { createColorFormatter, formatDim, isVerbose } from './helpers';

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
    readonly sql?: readonly string[];
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

  // SQL DDL preview (SQL family only)
  const planSql = result.plan?.sql;
  if (planSql) {
    lines.push('');
    lines.push(`${formatDimText('DDL preview')}`);
    if (planSql.length === 0) {
      lines.push(`${formatDimText('No DDL operations.')}`);
    } else {
      lines.push('');
      for (const statement of planSql) {
        const trimmed = statement.trim();
        if (!trimmed) continue;
        const line = trimmed.endsWith(';') ? trimmed : `${trimmed};`;
        lines.push(`${line}`);
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

export interface MigrationVerifyCommandOutputResult {
  readonly status: 'verified' | 'attested';
  readonly migrationId?: string;
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

export function formatMigrationVerifyCommandOutput(
  result: MigrationVerifyCommandOutputResult,
  flags: GlobalFlags,
): string {
  if (flags.quiet) {
    return '';
  }

  const lines: string[] = [];
  const useColor = flags.color !== false;
  const formatGreen = createColorFormatter(useColor, green);
  const formatYellow = createColorFormatter(useColor, yellow);
  const formatDimText = (text: string) => formatDim(useColor, text);

  switch (result.status) {
    case 'verified':
      lines.push(`${formatGreen('✔')} Migration verified`);
      if (result.migrationId) {
        lines.push(formatDimText(`  migrationId: ${result.migrationId}`));
      }
      break;
    case 'attested':
      lines.push(`${formatYellow('◉')} Draft migration attested`);
      if (result.migrationId) {
        lines.push(formatDimText(`  migrationId: ${result.migrationId}`));
      }
      break;
  }

  return lines.join('\n');
}

interface MigrationShowResult {
  readonly dirName: string;
  readonly dirPath: string;
  readonly from: string;
  readonly to: string;
  readonly migrationId: string | null;
  readonly kind: string;
  readonly createdAt: string;
  readonly operations: readonly {
    readonly id: string;
    readonly label: string;
    readonly operationClass: string;
  }[];
  readonly sql: readonly string[];
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
  lines.push(`${formatDimText(`  kind: ${result.kind}`)}`);
  lines.push(`${formatDimText(`  from: ${result.from}`)}`);
  lines.push(`${formatDimText(`  to:   ${result.to}`)}`);
  if (result.migrationId) {
    lines.push(`${formatDimText(`  migrationId: ${result.migrationId}`)}`);
  } else {
    lines.push(`${formatYellow('  migrationId: (draft — not yet attested)')}`);
  }
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

  if (result.sql.length > 0) {
    lines.push('');
    lines.push(`${formatDimText('DDL preview')}`);
    lines.push('');
    for (const statement of result.sql) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      const line = trimmed.endsWith(';') ? trimmed : `${trimmed};`;
      lines.push(`${line}`);
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
