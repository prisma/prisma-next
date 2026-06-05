import sqlFamilyPack from '@prisma-next/family-sql/pack';
import type { ExtensionPackRef } from '@prisma-next/framework-components/components';
import type {
  PostgresEnumStorageEntry,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type {
  ComposedAuthoringHelpers,
  ContractInput,
  ModelLike,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { defineContract as baseDefineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';

type SqlFamily = typeof sqlFamilyPack;
type PostgresPack = typeof postgresPack;

type TypesConstraint = Record<string, StorageTypeInstance | PostgresEnumStorageEntry>;
type ModelsConstraint = Record<string, ModelLike>;

type PostgresResult<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ReturnType<typeof baseDefineContract<SqlFamily, PostgresPack, Types, Models, ExtensionPacks>>,
  'target' | 'targetFamily'
> & {
  readonly target: PostgresPack['targetId'];
  readonly targetFamily: SqlFamily['familyId'];
};

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
  'family' | 'target' | 'types' | 'models'
>;

type PostgresDefinition<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = PostgresBaseScaffold<ExtensionPacks> & {
  readonly types?: Types;
  readonly models?: Models;
};

type PostgresScaffold<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = PostgresBaseScaffold<ExtensionPacks>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
>(
  definition: PostgresDefinition<Types, Models, ExtensionPacks>,
): PostgresResult<Types, Models, ExtensionPacks>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
>(
  scaffold: PostgresScaffold<ExtensionPacks>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, ExtensionPacks>) => {
    readonly types?: Types;
    readonly models?: Models;
  },
): PostgresResult<Types, Models, ExtensionPacks>;

export function defineContract(
  scaffold: Omit<ContractInput, 'family' | 'target'>,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
  },
): PostgresResult<TypesConstraint, ModelsConstraint, undefined> {
  const full = {
    ...scaffold,
    family: sqlFamilyPack,
    target: postgresPack,
    createNamespace: postgresCreateNamespace,
  } as ContractInput;
  if (factory !== undefined) {
    const { types: _t, models: _m, ...scaffoldOnly } = full;
    return baseDefineContract(
      scaffoldOnly,
      factory as Parameters<typeof baseDefineContract>[1],
    ) as unknown as PostgresResult<TypesConstraint, ModelsConstraint, undefined>;
  }
  return baseDefineContract(full) as unknown as PostgresResult<
    TypesConstraint,
    ModelsConstraint,
    undefined
  >;
}
