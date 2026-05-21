import mongoFamilyPack from '@prisma-next/family-mongo/pack';
import type {
  ContractDefinition,
  ContractFactory,
  ContractScaffold,
  MongoContractResult,
} from '@prisma-next/mongo-contract-ts/contract-builder';
import { defineContract as baseDefineContract } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTargetPack from '@prisma-next/target-mongo/pack';

type MongoFamilyPack = typeof mongoFamilyPack;
type MongoTargetPack = typeof mongoTargetPack;

// Helpers type derived from the exported ContractFactory rather than the
// un-exported ContractAuthoringHelpers, so we stay inside the public surface.
type MongoHelpers = Parameters<
  ContractFactory<
    Record<never, never>,
    Record<never, never>,
    undefined,
    MongoFamilyPack,
    MongoTargetPack,
    undefined
  >
>[0];

// Input types omit family + target AND explicitly forbid them so that
// `@ts-expect-error` tests can verify the fields are rejected.
type MongoDefinitionInput = Omit<
  ContractDefinition<MongoFamilyPack, MongoTargetPack>,
  'family' | 'target'
> & {
  readonly family?: never;
  readonly target?: never;
};

type MongoScaffoldInput = Omit<
  ContractScaffold<MongoFamilyPack, MongoTargetPack>,
  'family' | 'target'
> & {
  readonly family?: never;
  readonly target?: never;
};

// Overload 1: definition form — models / valueObjects inline in the definition object.
export function defineContract<const Definition extends MongoDefinitionInput>(
  definition: Definition,
): MongoContractResult<
  Definition & { readonly family: MongoFamilyPack; readonly target: MongoTargetPack }
>;

// Overload 2: factory form — models / valueObjects provided by a factory function.
export function defineContract<
  const Definition extends MongoScaffoldInput,
  const Built extends {
    readonly models?: Record<string, unknown>;
    readonly valueObjects?: Record<string, unknown>;
    readonly roots?: Record<string, string>;
  },
>(
  scaffold: Definition,
  factory: (helpers: MongoHelpers) => Built,
): MongoContractResult<
  Definition & Built & { readonly family: MongoFamilyPack; readonly target: MongoTargetPack }
>;

// Implementation — pre-binds family and target before delegating to the base.
// The `as unknown` cast is safe: every declared overload produces a MongoContractResult
// and the only difference between the public overload signatures and the impl is
// that we union both call forms here.
export function defineContract(
  definition: MongoDefinitionInput,
  factory?: (helpers: MongoHelpers) => {
    readonly models?: Record<string, unknown>;
    readonly valueObjects?: Record<string, unknown>;
    readonly roots?: Record<string, string>;
  },
): MongoContractResult<
  MongoDefinitionInput & { readonly family: MongoFamilyPack; readonly target: MongoTargetPack }
> {
  const full = {
    ...definition,
    family: mongoFamilyPack,
    target: mongoTargetPack,
  } as ContractDefinition<MongoFamilyPack, MongoTargetPack>;

  if (factory !== undefined) {
    return baseDefineContract(
      full as ContractScaffold<MongoFamilyPack, MongoTargetPack>,
      factory as unknown as Parameters<typeof baseDefineContract>[1],
    ) as unknown as MongoContractResult<
      MongoDefinitionInput & { readonly family: MongoFamilyPack; readonly target: MongoTargetPack }
    >;
  }

  return baseDefineContract(full) as unknown as MongoContractResult<
    MongoDefinitionInput & { readonly family: MongoFamilyPack; readonly target: MongoTargetPack }
  >;
}
