import sqlFamilyPack from '@prisma-next/family-sql/pack';
import type { ExtensionPackRef } from '@prisma-next/framework-components/components';
import type {
  PostgresEnumStorageEntry,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import {
  buildBoundContract,
  type ComposedAuthoringHelpers,
  type ContractInput,
  type EnumTypeHandle,
  field,
  type MergeEnums,
  type ModelLike,
  model,
  rel,
  type ScalarFieldBuilder,
} from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';

// Postgres-bound `defineContract` for sql-orm-client tests. This mirrors
// `@prisma-next/postgres/contract-builder`, but sql-orm-client cannot depend on
// `@prisma-next/postgres` (that package re-exports sql-orm-client, so the
// dependency would be a build cycle). Tests therefore bind the generic SQL
// contract-builder to the SQL family + Postgres target packs directly, exactly
// as the postgres package does.

export type { ScalarFieldBuilder };
export { field, model, rel };

type SqlFamily = typeof sqlFamilyPack;
type PostgresPack = typeof postgresPack;

type TypesConstraint = Record<string, StorageTypeInstance | PostgresEnumStorageEntry>;
type ModelsConstraint = Record<string, ModelLike>;
type EnumsConstraint = Record<string, EnumTypeHandle>;

type PostgresResult<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    PostgresPack,
    {
      readonly types?: Types;
      readonly models?: Models;
      readonly extensionPacks?: ExtensionPacks;
      readonly enums?: Enums;
    }
  >
>;

type PostgresBaseScaffold<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ContractInput<
    SqlFamily,
    PostgresPack,
    Record<never, never>,
    Record<never, never>,
    ExtensionPacks
  >,
  'family' | 'target' | 'types' | 'models' | 'enums'
>;

type PostgresDefinition<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
> = PostgresBaseScaffold<ExtensionPacks> & {
  readonly types?: Types;
  readonly models?: Models;
  readonly enums?: Enums;
};

type PostgresScaffold<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
> = PostgresBaseScaffold<ExtensionPacks> & {
  readonly types?: never;
  readonly models?: never;
  readonly enums?: Enums;
};

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const Enums extends EnumsConstraint = Record<never, never>,
>(
  definition: PostgresDefinition<Types, Models, ExtensionPacks, Enums>,
): PostgresResult<Types, Models, ExtensionPacks, Enums>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
>(
  scaffold: PostgresScaffold<ExtensionPacks, ScaffoldEnums>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, ExtensionPacks>) => {
    readonly types?: Types;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): PostgresResult<Types, Models, ExtensionPacks, MergeEnums<ScaffoldEnums, FactoryEnums>>;

export function defineContract(
  definition: PostgresDefinition<TypesConstraint, ModelsConstraint, undefined, EnumsConstraint>,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
    readonly enums?: EnumsConstraint;
  },
): PostgresResult<TypesConstraint, ModelsConstraint, undefined, EnumsConstraint> {
  const bound = { ...definition, createNamespace: postgresCreateNamespace };
  if (factory !== undefined) {
    return buildBoundContract(sqlFamilyPack, postgresPack, bound, factory);
  }
  return buildBoundContract(sqlFamilyPack, postgresPack, bound);
}
