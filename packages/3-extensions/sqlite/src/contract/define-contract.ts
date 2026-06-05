import sqlFamilyPack from '@prisma-next/family-sql/pack';
import type { ExtensionPackRef } from '@prisma-next/framework-components/components';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type {
  ComposedAuthoringHelpers,
  ContractInput,
  ModelLike,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { defineContract as baseDefineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { sqliteCreateNamespace } from '@prisma-next/target-sqlite/control';
import sqlitePack from '@prisma-next/target-sqlite/pack';

type SqlFamily = typeof sqlFamilyPack;
type SqlitePack = typeof sqlitePack;

type TypesConstraint = Record<string, StorageTypeInstance>;
type ModelsConstraint = Record<string, ModelLike>;

type SqliteResult<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ReturnType<typeof baseDefineContract<SqlFamily, SqlitePack, Types, Models, ExtensionPacks>>,
  'target' | 'targetFamily'
> & {
  readonly target: SqlitePack['targetId'];
  readonly targetFamily: SqlFamily['familyId'];
};

type SqliteBaseScaffold<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ContractInput<SqlFamily, SqlitePack, Record<never, never>, Record<never, never>, ExtensionPacks>,
  'family' | 'target' | 'types' | 'models'
>;

type SqliteDefinition<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = SqliteBaseScaffold<ExtensionPacks> & {
  readonly types?: Types;
  readonly models?: Models;
};

type SqliteScaffold<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = SqliteBaseScaffold<ExtensionPacks>;

const sqliteAuthoringDefaults = {
  createNamespace: sqliteCreateNamespace,
} as const;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
>(
  definition: SqliteDefinition<Types, Models, ExtensionPacks>,
): SqliteResult<Types, Models, ExtensionPacks>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
>(
  scaffold: SqliteScaffold<ExtensionPacks>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, SqlitePack, ExtensionPacks>) => {
    readonly types?: Types;
    readonly models?: Models;
  },
): SqliteResult<Types, Models, ExtensionPacks>;

export function defineContract(
  scaffold: Omit<ContractInput, 'family' | 'target'>,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, SqlitePack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
  },
): SqliteResult<TypesConstraint, ModelsConstraint, undefined> {
  const full = {
    ...scaffold,
    ...sqliteAuthoringDefaults,
    family: sqlFamilyPack,
    target: sqlitePack,
  } as ContractInput;
  if (factory !== undefined) {
    const { types: _t, models: _m, ...scaffoldOnly } = full;
    return baseDefineContract(
      { ...scaffoldOnly, ...sqliteAuthoringDefaults },
      factory as Parameters<typeof baseDefineContract>[1],
    ) as unknown as SqliteResult<TypesConstraint, ModelsConstraint, undefined>;
  }
  return baseDefineContract(full) as unknown as SqliteResult<
    TypesConstraint,
    ModelsConstraint,
    undefined
  >;
}
