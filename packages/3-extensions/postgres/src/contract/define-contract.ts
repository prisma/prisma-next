import sqlFamilyPack from '@prisma-next/family-sql/pack';
import type { ExtensionPackRef } from '@prisma-next/framework-components/components';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type {
  ComposedAuthoringHelpers,
  ContractInput,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { defineContract as baseDefineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

type SqlFamily = typeof sqlFamilyPack;
type PostgresPack = typeof postgresPack;

type TypesConstraint = Record<string, StorageTypeInstance>;
type ModelsConstraint = Record<string, object>;

// ContractInput fields shared across both overloads (without family, target, models)
type PostgresBaseDefinition<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
> = Omit<
  ContractInput<
    SqlFamily,
    PostgresPack,
    TypesConstraint,
    Record<never, never>,
    ExtensionPacks,
    Capabilities
  >,
  'family' | 'target' | 'models'
>;

type PostgresDefinition<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
> = PostgresBaseDefinition<ExtensionPacks, Capabilities> & {
  readonly models?: ModelsConstraint;
};

type PostgresScaffold<
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
> = Omit<PostgresBaseDefinition<ExtensionPacks, Capabilities>, 'types'>;

// Portable base return type with family/target fixed.
// Using only 2 type params keeps the type chain portable and resolves target: 'postgres'.
type PostgresBaseResult = ReturnType<typeof baseDefineContract<SqlFamily, PostgresPack>>;

// Overload 1: definition form (models/types inline in scaffold)
export function defineContract<
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
>(definition: PostgresDefinition<ExtensionPacks, Capabilities>): PostgresBaseResult;

// Overload 2: factory form (scaffold without models/types; factory provides them)
export function defineContract<
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
>(
  scaffold: PostgresScaffold<ExtensionPacks, Capabilities>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, ExtensionPacks>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
  },
): PostgresBaseResult;

// Implementation
export function defineContract(
  scaffold: Omit<ContractInput, 'family' | 'target'>,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
  },
): PostgresBaseResult {
  const full = {
    family: sqlFamilyPack,
    target: postgresPack,
    ...scaffold,
  } as ContractInput;
  if (factory !== undefined) {
    return baseDefineContract(
      full,
      factory as Parameters<typeof baseDefineContract>[1],
    ) as PostgresBaseResult;
  }
  return baseDefineContract(full) as PostgresBaseResult;
}
