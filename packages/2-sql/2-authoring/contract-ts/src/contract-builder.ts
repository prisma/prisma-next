import type { ForeignKeyDefaultsState } from '@prisma-next/contract-authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import type { Namespace } from '@prisma-next/framework-components/ir';
import type {
  PostgresEnumStorageEntry,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
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

type ModelLike = {
  readonly stageOne: {
    readonly modelName?: string;
    readonly fields: Record<string, ScalarFieldBuilder>;
    readonly relations: Record<string, RelationBuilder<RelationState>>;
  };
  readonly __attributes: ModelAttributesSpec | undefined;
  readonly __sql: SqlStageSpec | undefined;
  buildAttributesSpec(): ModelAttributesSpec | undefined;
  buildSqlSpec(): SqlStageSpec | undefined;
};

type ContractDefinition<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance | PostgresEnumStorageEntry>,
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
  readonly namespaces?: readonly string[];
  readonly createNamespace?: (id: string) => Namespace;
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
  readonly namespaces?: readonly string[];
  readonly createNamespace?: (id: string) => Namespace;
  readonly codecLookup?: CodecLookup;
};

type ContractFactory<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance | PostgresEnumStorageEntry>,
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

/**
 * Per-target reserved namespace names enforced by `defineContract` for
 * SQL family contracts. Two categories:
 *
 * 1. **IR sentinels** (`__unbound__`, `__unspecified__`) — reserved on
 *    every SQL target. The double-underscore decoration marks them as
 *    framework-reserved coordinates; user code must not declare them
 *    explicitly.
 * 2. **Target-specific PSL keywords** — Postgres reserves the bare
 *    `unbound` identifier for the late-binding opt-in
 *    (`namespace unbound { … }`) so the TS surface must reject it from
 *    `defineContract({ namespaces })` lists. SQLite has no schema
 *    concept and rejects every non-empty namespaces list outright;
 *    callers should declare `namespaces: []` or omit the field.
 */
function validateNamespaceDeclarations(
  target: TargetPackRef<'sql', string>,
  namespaces: readonly string[] | undefined,
): void {
  if (!namespaces) {
    return;
  }

  if (target.targetId === 'sqlite' && namespaces.length > 0) {
    throw new Error(
      `defineContract: SQLite contracts cannot declare namespaces (SQLite has no schema concept; emitted DDL is always unqualified). Received namespaces: [${namespaces
        .map((name) => `"${name}"`)
        .join(', ')}].`,
    );
  }

  const seen = new Set<string>();
  for (const namespace of namespaces) {
    if (namespace.length === 0) {
      throw new Error('defineContract: namespace names cannot be empty.');
    }
    if (namespace.trim().length === 0) {
      throw new Error(`defineContract: namespace name "${namespace}" cannot be whitespace-only.`);
    }
    if (namespace === '__unbound__' || namespace === '__unspecified__') {
      throw new Error(
        `defineContract: namespace name "${namespace}" is a reserved IR sentinel and cannot appear in the declared namespaces list.`,
      );
    }
    if (target.targetId === 'postgres' && namespace === 'unbound') {
      throw new Error(
        `defineContract: namespace name "unbound" is reserved by Postgres for the late-binding opt-in (use \`namespace unbound { … }\` in PSL instead of declaring it as a regular schema).`,
      );
    }
    if (seen.has(namespace)) {
      throw new Error(`defineContract: namespaces list contains duplicate entry "${namespace}".`);
    }
    seen.add(namespace);
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
): SqlContractResult<Definition>;

function buildContractFromDsl(
  definition: ContractInput,
): ReturnType<typeof buildSqlContractFromDefinition> {
  validateTargetPackRef(definition.family, definition.target);
  validateExtensionPackRefs(definition.target, definition.extensionPacks);
  validateNamespaceDeclarations(definition.target, definition.namespaces);

  return buildSqlContractFromDefinition(
    buildContractDefinition(definition),
    definition.codecLookup,
  );
}

export function defineContract<
  const Family extends FamilyPackRef<string>,
  const Target extends TargetPackRef<'sql', string>,
  const Types extends Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = Record<
    never,
    never
  >,
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
  const Types extends Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = Record<
    never,
    never
  >,
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
    Record<string, StorageTypeInstance | PostgresEnumStorageEntry>,
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

export type { ComposedAuthoringHelpers, ContractInput, ContractModelBuilder, ScalarFieldBuilder };
export { field, model, rel };
