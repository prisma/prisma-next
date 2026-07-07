import type { Contract } from '@prisma-next/contract/types';
import type {
  ContractSerializer,
  MigratableTargetDescriptor,
  SchemaVerifier,
} from '@prisma-next/framework-components/control';
import type { PslDocumentAst } from '@prisma-next/framework-components/psl-ast';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationDescriptors } from '@prisma-next/sql-operations';
import type { SqlSchemaIR, SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import type { SqlControlAdapter } from './control-adapter';
import type { SqlControlFamilyInstance } from './control-instance';
import type { SqlDiffDatabaseSchema, SqlVerifyDatabaseSchema } from './migrations/schema-differ';
import type { SqlMigrationPlanner, SqlMigrationRunner } from './migrations/types';

/**
 * One stack extension pack's already-assembled contract, paired with the
 * `spaceId` its extension descriptor was registered under. `contract infer`
 * needs both: the contract to know which elements the pack describes and to
 * resolve the domain model a cross-space foreign key targets, the `spaceId`
 * to qualify the emitted relation type (`<spaceId>:<namespace>.<Model>`).
 * Neither the contract JSON nor the framework's `ContractSpace` wrapper
 * self-declares its owning space id — it is only known from the extension
 * descriptor that carries the `ContractSpace`.
 */
export interface SqlDescribedContractSpace {
  readonly spaceId: string;
  readonly contract: Contract<SqlStorage>;
}

export interface SqlControlTargetDescriptor<
  TTargetId extends string,
  TTargetDetails,
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends MigratableTargetDescriptor<'sql', TTargetId, SqlControlFamilyInstance> {
  readonly queryOperations?: () => SqlOperationDescriptors;
  /**
   * JSON ⇄ class boundary for the SQL target's contract. The descriptor
   * composes a concrete `SqlContractSerializerBase` subclass; the rest
   * of the control stack reaches `descriptor.contractSerializer` rather
   * than importing a per-target deserialization function.
   */
  readonly contractSerializer: ContractSerializer<TContract>;
  /**
   * Per-target schema verifier walking the contract against
   * `SqlSchemaIR`. The descriptor composes a concrete
   * `SqlSchemaVerifierBase` subclass; the family-shared walk lives on
   * the base, the target-specific dispatch on the subclass.
   */
  readonly schemaVerifier: SchemaVerifier<TContract, SqlSchemaIR>;
  /**
   * Database→PSL inference for `contract infer`. Target logic (owns the dialect
   * maps), so it lives on the descriptor. Optional: targets without `contract
   * infer` (Mongo) omit it, and the family instance throws when it is absent.
   * `describedContracts` carries the stack's extension packs' already-assembled
   * contracts (each paired with its `spaceId`) so the inferrer can omit elements
   * they already describe, and can qualify a cross-space relation with the
   * owning pack's space id.
   */
  readonly inferPslContract?: (
    schema: SqlSchemaIRNode,
    describedContracts?: readonly SqlDescribedContractSpace[],
  ) => PslDocumentAst;
  /**
   * The single combined database-schema diff of two derived representations —
   * the target's black-box comparison. Every SQL target provides it (Postgres
   * returns relational + policy issues; SQLite returns relational only). It is
   * schema logic on the target, not database I/O, so it lives here rather than
   * on the control adapter. How it computes the two issue sets is private.
   * See {@link SqlDiffDatabaseSchema} / {@link SqlVerifyDatabaseSchema}.
   */
  readonly diffDatabaseSchema: SqlDiffDatabaseSchema;
  /**
   * The same combined comparison as {@link diffDatabaseSchema}, wrapped in the
   * verify envelope (`ok`/`summary`/`code`/`target`/`timings`) plus the
   * pass/warn/fail tree the CLI renders. Verify calls this instead of
   * `diffDatabaseSchema` so the relational walk that produces the tree runs
   * once per verify, not once for the diff and again for the tree.
   */
  readonly verifyDatabaseSchema: SqlVerifyDatabaseSchema;
  createPlanner(adapter: SqlControlAdapter<TTargetId>): SqlMigrationPlanner<TTargetDetails>;
  createRunner(family: SqlControlFamilyInstance): SqlMigrationRunner<TTargetDetails>;
}
