import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  DiffableNode,
  SchemaDiffer,
  SchemaDiffIssue,
} from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';

/**
 * Inputs to a SQL target's schema-differ (`diffDatabaseSchema` on the
 * descriptor): the contract (the expected side derives from it), the
 * introspected actual schema node, and the resolution context the relational
 * diff needs.
 */
export interface DiffDatabaseSchemaInput {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly strict: boolean;
  readonly typeMetadataRegistry: ReadonlyMap<string, { readonly nativeType?: string }>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

/**
 * The `SchemaDiffer` a SQL target implements: the black-box comparison of the
 * contract's expected schema against the introspected actual schema, projected
 * to the two issue lists. How it computes them is private to the target.
 */
export type SqlDiffDatabaseSchema = SchemaDiffer<DiffDatabaseSchemaInput>['diff'];

/**
 * The full-tree node diff a SQL target produces for the family verify
 * verdict: the target derives the expected tree from the contract, applies
 * the pre-diff normalizations (semantic satisfaction, FK schema-segment
 * resolution), runs the generic differ, and ownership-scopes the result.
 * Strict gating, control-policy disposition, and the verdict itself are the
 * family's post-diff filters over this output.
 */
export interface SqlSchemaDiffForVerdict {
  /** The full, ownership-scoped diff issue list. */
  readonly issues: readonly SchemaDiffIssue[];
  /** The expected tree the diff ran over (control-policy path resolution). */
  readonly expectedRoot: DiffableNode;
  /**
   * The expected/actual namespace-node pairs the codec `verifyType` hooks
   * run over — one per contract namespace with tables, paired by DDL
   * schema; a flat target repeats its sole actual root per such namespace.
   */
  readonly namespacePairs: ReadonlyArray<{ readonly actual: SqlSchemaIRNode | undefined }>;
}

export interface DiffSchemaForVerdictInput {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

export type SqlDiffSchemaForVerdict = (input: DiffSchemaForVerdictInput) => SqlSchemaDiffForVerdict;
