import { Contract, PlanArtifacts, DiffSummary, ChangeDetail } from './types';
import { Meta, OpSetWithVersion } from '../program';

/**
 * Generate migration ID from timestamp and summary
 */
export function generateMigrationId(
  summary: {
    tablesAdded: number;
    columnsAdded: number;
    uniquesAdded: number;
    indexesAdded: number;
    fksAdded: number;
  },
  override?: string,
): string {
  if (override) {
    return override;
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, '').substring(0, 13); // YYYYMMDDTHHMM

  // Generate slug from summary
  const parts: string[] = [];
  if (summary.tablesAdded > 0) parts.push('add-tables');
  if (summary.columnsAdded > 0) parts.push('add-columns');
  if (summary.uniquesAdded > 0) parts.push('add-uniques');
  if (summary.indexesAdded > 0) parts.push('add-indexes');
  if (summary.fksAdded > 0) parts.push('add-fks');

  const slug = parts.length > 0 ? parts.join('-') : 'schema-changes';

  return `${timestamp}_${slug}`;
}

/**
 * Build meta.json artifact
 */
export function buildMeta(
  id: string,
  contractA: Contract | { kind: 'empty' },
  contractB: Contract,
  opSetHash: `sha256:${string}`,
): Meta {
  const fromHash =
    'kind' in contractA && contractA.kind === 'empty'
      ? { kind: 'empty' as const }
      : { kind: 'contract' as const, hash: contractA.contractHash! };

  return {
    id,
    target: 'postgres',
    from: fromHash,
    to: { kind: 'contract', hash: contractB.contractHash! },
    opSetHash,
    mode: 'strict',
    supersedes: [],
  };
}

/**
 * Build diff.json artifact
 */
export function buildDiffJson(
  contractA: Contract | { kind: 'empty' },
  contractB: Contract,
  changes: {
    addedTables: string[];
    addedColumns: Array<{ table: string; column: string }>;
    addedUniques: Array<{ table: string; columns: string[] }>;
    addedIndexes: Array<{ table: string; columns: string[] }>;
    addedForeignKeys: Array<{
      table: string;
      columns: string[];
      ref: { table: string; columns: string[] };
    }>;
  },
): DiffSummary {
  const fromHash =
    'kind' in contractA && contractA.kind === 'empty'
      ? ('empty' as const)
      : contractA.contractHash!;

  const changeDetails: ChangeDetail[] = [];

  // Add table changes
  for (const tableName of changes.addedTables) {
    changeDetails.push({
      kind: 'addTable',
      table: tableName,
      columnCount: Object.keys(contractB.tables[tableName].columns || {}).length,
    });
  }

  // Add column changes
  for (const { table, column } of changes.addedColumns) {
    const columnDef = contractB.tables[table].columns[column];
    changeDetails.push({
      kind: 'addColumn',
      table,
      column,
      type: columnDef.type,
      nullable: columnDef.nullable,
    });
  }

  // Add unique changes
  for (const { table, columns } of changes.addedUniques) {
    changeDetails.push({
      kind: 'addUnique',
      table,
      columns,
    });
  }

  // Add index changes
  for (const { table, columns } of changes.addedIndexes) {
    changeDetails.push({
      kind: 'addIndex',
      table,
      columns,
    });
  }

  // Add FK changes
  for (const { table, columns, ref } of changes.addedForeignKeys) {
    changeDetails.push({
      kind: 'addForeignKey',
      table,
      columns,
      ref,
    });
  }

  return {
    from: fromHash,
    to: contractB.contractHash!,
    summary: {
      tablesAdded: changes.addedTables.length,
      columnsAdded: changes.addedColumns.length,
      uniquesAdded: changes.addedUniques.length,
      indexesAdded: changes.addedIndexes.length,
      fksAdded: changes.addedForeignKeys.length,
    },
    changes: changeDetails,
  };
}

/**
 * Build notes.md artifact
 */
export function buildNotesMarkdown(
  id: string,
  contractA: Contract | { kind: 'empty' },
  contractB: Contract,
  diff: DiffSummary,
): string {
  const fromHash =
    'kind' in contractA && contractA.kind === 'empty' ? 'empty' : contractA.contractHash!;

  const lines = [
    `# Migration: ${id}`,
    '',
    `From: ${fromHash}`,
    `To: ${contractB.contractHash}`,
    '',
    '## Summary',
  ];

  const { summary } = diff;
  const summaryParts: string[] = [];

  if (summary.tablesAdded > 0)
    summaryParts.push(`Added ${summary.tablesAdded} table${summary.tablesAdded === 1 ? '' : 's'}`);
  if (summary.columnsAdded > 0)
    summaryParts.push(
      `Added ${summary.columnsAdded} column${summary.columnsAdded === 1 ? '' : 's'}`,
    );
  if (summary.uniquesAdded > 0)
    summaryParts.push(
      `Added ${summary.uniquesAdded} unique constraint${summary.uniquesAdded === 1 ? '' : 's'}`,
    );
  if (summary.indexesAdded > 0)
    summaryParts.push(
      `Added ${summary.indexesAdded} index${summary.indexesAdded === 1 ? '' : 'es'}`,
    );
  if (summary.fksAdded > 0)
    summaryParts.push(`Added ${summary.fksAdded} foreign key${summary.fksAdded === 1 ? '' : 's'}`);

  if (summaryParts.length === 0) {
    lines.push('- No changes');
  } else {
    lines.push(...summaryParts.map((part) => `- ${part}`));
  }

  lines.push('', '## Changes');

  for (const change of diff.changes) {
    switch (change.kind) {
      case 'addTable':
        lines.push(`- Add table \`${change.table}\` (${change.columnCount} columns)`);
        break;
      case 'addColumn':
        const nullable = change.nullable ? 'NULL' : 'NOT NULL';
        lines.push(
          `- Add column \`${change.table}.${change.column}\` (${change.type}, ${nullable})`,
        );
        break;
      case 'addUnique':
        lines.push(`- Add unique constraint on \`${change.table}.${change.columns.join(', ')}\``);
        break;
      case 'addIndex':
        lines.push(`- Add index on \`${change.table}.${change.columns.join(', ')}\``);
        break;
      case 'addForeignKey':
        lines.push(
          `- Add foreign key \`${change.table}.${change.columns.join(', ')}\` → \`${change.ref.table}.${change.ref.columns.join(', ')}\``,
        );
        break;
    }
  }

  return lines.join('\n');
}

/**
 * Generate all artifacts for a migration plan
 */
export function generateArtifacts(
  contractA: Contract | { kind: 'empty' },
  contractB: Contract,
  opset: OpSetWithVersion,
  opSetHash: `sha256:${string}`,
  changes: {
    addedTables: string[];
    addedColumns: Array<{ table: string; column: string }>;
    addedUniques: Array<{ table: string; columns: string[] }>;
    addedIndexes: Array<{ table: string; columns: string[] }>;
    addedForeignKeys: Array<{
      table: string;
      columns: string[];
      ref: { table: string; columns: string[] };
    }>;
  },
  id?: string,
): Omit<PlanArtifacts, 'opset' | 'opSetHash'> {
  const summary = {
    tablesAdded: changes.addedTables.length,
    columnsAdded: changes.addedColumns.length,
    uniquesAdded: changes.addedUniques.length,
    indexesAdded: changes.addedIndexes.length,
    fksAdded: changes.addedForeignKeys.length,
  };

  const migrationId = generateMigrationId(summary, id);
  const meta = buildMeta(migrationId, contractA, contractB, opSetHash);
  const diffJson = buildDiffJson(contractA, contractB, changes);
  const notesMd = buildNotesMarkdown(migrationId, contractA, contractB, diffJson);

  return {
    meta,
    diffJson,
    notesMd,
  };
}
