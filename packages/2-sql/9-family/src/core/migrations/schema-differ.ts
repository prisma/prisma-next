import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  SchemaDiffer,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';

/**
 * Inputs to a SQL target's schema-differ (`diffDatabaseSchema` /
 * `verifyDatabaseSchema` on the descriptor): the contract (the expected side
 * derives from it), the introspected actual schema node, and the resolution
 * context the relational diff needs.
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
 * The same combined comparison as {@link SqlDiffDatabaseSchema}, wrapped in the
 * verify envelope (`ok`/`summary`/`code`/`target`/`timings`) plus the
 * pass/warn/fail tree the CLI renders. Verify calls this instead of the diff so
 * the relational walk that produces the tree runs once per verify, not once for
 * the diff and again for the tree.
 */
export type SqlVerifyDatabaseSchema = (
  input: DiffDatabaseSchemaInput,
) => VerifyDatabaseSchemaResult;
