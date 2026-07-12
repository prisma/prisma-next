import sqlFamilyPack from '@prisma-next/family-sql/pack';
import type { ExtensionPackRef } from '@prisma-next/framework-components/components';
import type {
  SqlNamespaceBase,
  SqlNamespaceInput,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type {
  ComposedAuthoringHelpers,
  ContractInput,
  EnumTypeHandle,
  MergeEnums,
  ModelLike,
  PackEntitiesInput,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { buildBoundContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type { RlsEntityHandle } from './rls';
import { lowerRlsEntities } from './rls-lowering';

type SqlFamily = typeof sqlFamilyPack;
type PostgresPack = typeof postgresPack;

type TypesConstraint = Record<string, StorageTypeInstance>;
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
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
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
  'family' | 'target' | 'types' | 'models' | 'enums' | 'createNamespace'
> & {
  /**
   * RLS handles (`policy*`, `rlsEnabled`, `role`) lowered into the generic
   * pack-entities channel at build time, mirroring the PSL `policy_*` /
   * `@@rls` lowering key-for-key and wire-name-for-wire-name.
   */
  readonly entities?: readonly RlsEntityHandle[];
};

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

// Implementation — delegates to buildBoundContract which pre-binds family/target,
// carrying zero casts at this layer. When `entities` is present the delegation
// goes through a wrapping factory: the RLS lowering needs the full model set
// (scaffold + factory-built), which only exists inside the factory invocation,
// and its lowered pack entities ride the factory's `packEntities` return so
// buildBoundContract's own merge and collision guards stay authoritative.
export function defineContract(
  definition: PostgresDefinition<TypesConstraint, ModelsConstraint, undefined, EnumsConstraint>,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
    readonly enums?: EnumsConstraint;
  },
): PostgresResult<TypesConstraint, ModelsConstraint, undefined, EnumsConstraint> {
  const { entities, ...rest } = definition;
  const bound = { ...rest, createNamespace: postgresCreateNamespace };
  if (entities === undefined || entities.length === 0) {
    if (factory !== undefined) {
      return buildBoundContract(sqlFamilyPack, postgresPack, bound, factory);
    }
    return buildBoundContract(sqlFamilyPack, postgresPack, bound);
  }

  const loweringFactory = (
    helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>,
  ): {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
    readonly enums?: EnumsConstraint;
    readonly packEntities?: PackEntitiesInput;
  } => {
    const built = factory !== undefined ? factory(helpers) : {};
    const models = { ...(bound.models ?? {}), ...(built.models ?? {}) };
    const types = { ...(bound.types ?? {}), ...(built.types ?? {}) };
    const packEntities = lowerRlsEntities(entities, {
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      ...ifDefined('naming', bound.naming),
      ...ifDefined('namespaces', bound.namespaces),
      ...ifDefined('extensionPacks', bound.extensionPacks),
      ...ifDefined('foreignKeyDefaults', bound.foreignKeyDefaults),
      ...(Object.keys(models).length > 0 ? { models } : {}),
      ...(Object.keys(types).length > 0 ? { types } : {}),
    });
    return { ...built, ...ifDefined('packEntities', packEntities) };
  };
  return buildBoundContract(sqlFamilyPack, postgresPack, bound, loweringFactory);
}
