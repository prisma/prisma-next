import type { ForeignKeyDefaultsState } from '@prisma-next/contract-authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { buildSqlContractFromDefinition } from './build-contract';
import {
  type ComposedAuthoringHelpers,
  createComposedAuthoringHelpers,
} from './composed-authoring-helpers';
import {
  type ContractInput,
  type ContractModelBuilder,
  field,
  isContractInput,
  type ModelAttributesSpec,
  model,
  type RelationBuilder,
  type RelationState,
  rel,
  type ScalarFieldBuilder,
  type SqlStageSpec,
} from './contract-dsl';
import { buildContractDefinition } from './contract-lowering';
import type { SqlContractResult } from './contract-types';

export { buildSqlContractFromDefinition } from './build-contract';

type ModelLike = ContractModelBuilder<
  string | undefined,
  Record<string, ScalarFieldBuilder>,
  Record<string, RelationBuilder<RelationState>>,
  ModelAttributesSpec | undefined,
  SqlStageSpec | undefined
>;

type ContractDefinition<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance>,
  Models extends Record<string, ModelLike>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
  Naming extends ContractInput['naming'] | undefined,
  StorageHash extends string | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined,
> = {
  readonly family: Family;
  readonly target: Target;
  readonly extensionPacks?: ExtensionPacks;
  readonly naming?: Naming;
  readonly storageHash?: StorageHash;
  readonly foreignKeyDefaults?: ForeignKeyDefaults;
  readonly capabilities?: Capabilities;
  readonly types?: Types;
  readonly models?: Models;
  readonly codecLookup?: CodecLookup;
};

type ContractScaffold<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
  Naming extends ContractInput['naming'] | undefined,
  StorageHash extends string | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined,
> = {
  readonly family: Family;
  readonly target: Target;
  readonly extensionPacks?: ExtensionPacks;
  readonly naming?: Naming;
  readonly storageHash?: StorageHash;
  readonly foreignKeyDefaults?: ForeignKeyDefaults;
  readonly capabilities?: Capabilities;
  readonly codecLookup?: CodecLookup;
};

type ContractFactory<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance>,
  Models extends Record<string, ModelLike>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = (helpers: ComposedAuthoringHelpers<Family, Target, ExtensionPacks>) => {
  readonly types?: Types;
  readonly models?: Models;
};

function validateTargetPackRef(
  family: FamilyPackRef<string>,
  target: TargetPackRef<'sql', string>,
): void {
  if (family.familyId !== 'sql') {
    throw new Error(
      `defineContract only accepts SQL family packs. Received family "${family.familyId}".`,
    );
  }

  if (target.familyId !== family.familyId) {
    throw new Error(
      `target pack "${target.id}" targets family "${target.familyId}" but contract family is "${family.familyId}".`,
    );
  }
}

function validateExtensionPackRefs(
  target: TargetPackRef<'sql', string>,
  extensionPacks?: Record<string, ExtensionPackRef<'sql', string>>,
): void {
  if (!extensionPacks) {
    return;
  }

  for (const packRef of Object.values(extensionPacks)) {
    if (packRef.kind !== 'extension') {
      throw new Error(
        `defineContract only accepts extension pack refs in extensionPacks. Received kind "${packRef.kind}".`,
      );
    }

    if (packRef.familyId !== target.familyId) {
      throw new Error(
        `extension pack "${packRef.id}" targets family "${packRef.familyId}" but contract target family is "${target.familyId}".`,
      );
    }

    if (packRef.targetId && packRef.targetId !== target.targetId) {
      throw new Error(
        `extension pack "${packRef.id}" targets "${packRef.targetId}" but contract target is "${target.targetId}".`,
      );
    }
  }
}

function buildContractFromDsl<Definition extends ContractInput>(
  definition: Definition,
): SqlContractResult<Definition> {
  validateTargetPackRef(definition.family, definition.target);
  validateExtensionPackRefs(definition.target, definition.extensionPacks);

  return buildSqlContractFromDefinition(
    buildContractDefinition(definition),
    definition.codecLookup,
  ) as unknown as SqlContractResult<Definition>;
}

export function defineContract<
  const Family extends FamilyPackRef<string>,
  const Target extends TargetPackRef<'sql', string>,
  const Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  const Models extends Record<string, ModelLike> = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
  const Naming extends ContractInput['naming'] | undefined = undefined,
  const StorageHash extends string | undefined = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined = undefined,
>(
  definition: ContractDefinition<
    Family,
    Target,
    Types,
    Models,
    ExtensionPacks,
    Capabilities,
    Naming,
    StorageHash,
    ForeignKeyDefaults
  >,
): SqlContractResult<
  ContractDefinition<
    Family,
    Target,
    Types,
    Models,
    ExtensionPacks,
    Capabilities,
    Naming,
    StorageHash,
    ForeignKeyDefaults
  >
>;
export function defineContract<
  const Family extends FamilyPackRef<string>,
  const Target extends TargetPackRef<'sql', string>,
  const Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  const Models extends Record<string, ModelLike> = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
  const Naming extends ContractInput['naming'] | undefined = undefined,
  const StorageHash extends string | undefined = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined = undefined,
>(
  definition: ContractScaffold<
    Family,
    Target,
    ExtensionPacks,
    Capabilities,
    Naming,
    StorageHash,
    ForeignKeyDefaults
  >,
  factory: ContractFactory<Family, Target, Types, Models, ExtensionPacks>,
): SqlContractResult<
  ContractDefinition<
    Family,
    Target,
    Types,
    Models,
    ExtensionPacks,
    Capabilities,
    Naming,
    StorageHash,
    ForeignKeyDefaults
  >
>;
export function defineContract(
  definition: ContractInput,
  factory?: ContractFactory<
    FamilyPackRef<string>,
    TargetPackRef<'sql', string>,
    Record<string, StorageTypeInstance>,
    Record<string, ModelLike>,
    Record<string, ExtensionPackRef<'sql', string>> | undefined
  >,
): SqlContractResult<ContractInput> {
  if (!isContractInput(definition)) {
    throw new TypeError(
      'defineContract expects a contract definition object. Define your contract with defineContract({ family, target, models, ... }).',
    );
  }

  if (!factory) {
    return buildContractFromDsl(definition);
  }

  const builtDefinition = {
    ...definition,
    ...factory(
      createComposedAuthoringHelpers({
        family: definition.family,
        target: definition.target,
        extensionPacks: definition.extensionPacks,
      }),
    ),
  };

  return buildContractFromDsl(builtDefinition);
}

export { field, model, rel };
export type { ComposedAuthoringHelpers, ContractInput, ContractModelBuilder, ScalarFieldBuilder };
