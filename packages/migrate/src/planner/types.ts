import { Schema } from '@prisma/relational-ir';
import { OpSetWithVersion, Meta } from '../program';

// Contract type alias for clarity
export type Contract = Schema;

// Planner configuration options
export interface PlannerOptions {
  id?: string; // Optional migration ID override
  rulesVersion?: string; // Defaults to "1"
}

// Complete migration artifacts
export interface PlanArtifacts {
  opset: OpSetWithVersion;
  opSetHash: `sha256:${string}`;
  meta: Meta;
  diffJson: DiffSummary;
  notesMd: string;
}

// Machine-readable diff summary
export interface DiffSummary {
  from: `sha256:${string}` | 'empty';
  to: `sha256:${string}`;
  summary: {
    tablesAdded: number;
    columnsAdded: number;
    uniquesAdded: number;
    indexesAdded: number;
    fksAdded: number;
  };
  changes: ChangeDetail[];
}

// Individual change details
export type ChangeDetail =
  | { kind: 'addTable'; table: string; columnCount: number }
  | { kind: 'addColumn'; table: string; column: string; type: string; nullable: boolean }
  | { kind: 'addUnique'; table: string; columns: string[] }
  | { kind: 'addIndex'; table: string; columns: string[] }
  | {
      kind: 'addForeignKey';
      table: string;
      columns: string[];
      ref: { table: string; columns: string[] };
    };

// Normalized contract for comparison (empty tables = {})
export interface NormalizedContract {
  tables: Record<string, any>;
}

// Change detection results
export interface ChangeDetectionResult {
  unsupportedChanges: UnsupportedChange[];
  addedTables: string[];
  addedColumns: Array<{ table: string; column: string }>;
  addedUniques: Array<{ table: string; columns: string[] }>;
  addedIndexes: Array<{ table: string; columns: string[] }>;
  addedForeignKeys: Array<{
    table: string;
    columns: string[];
    ref: { table: string; columns: string[] };
  }>;
}

// Unsupported change types
export type UnsupportedChange =
  | { kind: 'rename'; type: 'table' | 'column'; old: string; new: string; table?: string }
  | { kind: 'drop'; type: 'table' | 'column'; name: string; table?: string }
  | { kind: 'typeChange'; table: string; column: string; oldType: string; newType: string }
  | { kind: 'notNullWithoutDefault'; table: string; column: string };
