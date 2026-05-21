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

type SqlFamily = typeof sqlFamilyPack;
type PostgresPack = typeof postgresPack;

type TypesConstraint = Record<string, StorageTypeInstance | PostgresEnumStorageEntry>;
type ModelsConstraint = Record<string, ModelLike>;

// Return type threaded with all inferred type params.
// We override target/targetFamily via intersection to preserve the literal values
// ('postgres', 'sql') even when TypeScript defers conditional-type evaluation on
// unresolved generic params.
type PostgresResult<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
> = Omit<
  ReturnType<
    typeof baseDefineContract<SqlFamily, PostgresPack, Types, Models, ExtensionPacks, Capabilities>
  >,
  'target' | 'targetFamily'
> & {
  readonly target: PostgresPack['targetId'];
  readonly targetFamily: SqlFamily['familyId'];
};

// Scaffold that carries all ContractInput fields EXCEPT family, target, types, models.
// Built from ContractInput with concrete Record<never, never> defaults to avoid
// the ContractInput Models constraint (which requires ContractModelBuilder, not ModelLike).
type PostgresBaseScaffold<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
> = Omit<
  ContractInput<
    SqlFamily,
    PostgresPack,
    Record<never, never>,
    Record<never, never>,
    ExtensionPacks,
    Capabilities
  >,
  'family' | 'target' | 'types' | 'models'
>;

// Definition form: inline types + models (uses ModelLike for models, not ContractModelBuilder)
type PostgresDefinition<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
> = PostgresBaseScaffold<ExtensionPacks, Capabilities> & {
  readonly types?: Types;
  readonly models?: Models;
};

// Factory form: scaffold without types/models (factory provides them)
type PostgresScaffold<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
> = PostgresBaseScaffold<ExtensionPacks, Capabilities>;

// Overload 1: definition form (models/types inline in scaffold)
export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
>(
  definition: PostgresDefinition<Types, Models, ExtensionPacks, Capabilities>,
): PostgresResult<Types, Models, ExtensionPacks, Capabilities>;

// Overload 2: factory form (scaffold without models/types; factory provides them)
export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
>(
  scaffold: PostgresScaffold<ExtensionPacks, Capabilities>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, ExtensionPacks>) => {
    readonly types?: Types;
    readonly models?: Models;
  },
): PostgresResult<Types, Models, ExtensionPacks, Capabilities>;

// Implementation — the runtime type is richer than the wide impl signature;
// as unknown is safe because every declared overload produces a PostgresResult.
export function defineContract(
  scaffold: Omit<ContractInput, 'family' | 'target'>,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
  },
): PostgresResult<TypesConstraint, ModelsConstraint, undefined, undefined> {
  const full = {
    ...scaffold,
    family: sqlFamilyPack,
    target: postgresPack,
  } as ContractInput;
  if (factory !== undefined) {
    return baseDefineContract(
      full,
      factory as Parameters<typeof baseDefineContract>[1],
    ) as unknown as PostgresResult<TypesConstraint, ModelsConstraint, undefined, undefined>;
  }
  return baseDefineContract(full) as unknown as PostgresResult<
    TypesConstraint,
    ModelsConstraint,
    undefined,
    undefined
  >;
}
