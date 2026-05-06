import type {
  FieldKind,
  FieldNullability,
  FieldRef,
  InputFieldMap,
  InputShapeFromFields,
  MaybePromise,
  ObjectRef,
  SchemaTypes,
  TypeParam,
} from '@pothos/core';
import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Collection,
  DefaultCollectionTypeState,
  DefaultModelRow,
  IncludeRefinementCollection,
  IncludeRefinementResult,
  IsToManyRelation,
  RelatedModelName,
  RelationNames,
} from '@prisma-next/sql-orm-client';
import type { GraphQLResolveInfo } from 'graphql';
import type { PothosPrismaNextPlugin } from './index';
import type { PrismaNextPluginOptions } from './types';

/**
 * Resolve the per-model parent row shape from the user's Contract using the
 * orm-client's `DefaultModelRow`. Pothos's `t.exposeID/String/...` reads
 * keys off this shape, so plumbing the concrete row type through is what
 * makes those compatibility constraints succeed.
 */
type RowFor<
  Types extends SchemaTypes,
  ModelName extends string,
> = Types['PrismaNextContract'] extends Contract<SqlStorage>
  ? DefaultModelRow<Types['PrismaNextContract'], ModelName>
  : Record<string, unknown>;

/**
 * Names of the user-declared relations on a model, derived from the
 * contract via the orm-client's `RelationNames`. Falls back to `string`
 * if the contract isn't typed (the default-Contract<SqlStorage> case).
 */
type RelationsOnModel<
  Types extends SchemaTypes,
  ModelName extends string,
> = Types['PrismaNextContract'] extends Contract<SqlStorage>
  ? RelationNames<Types['PrismaNextContract'], ModelName>
  : string;

/**
 * Input/output type for a relation's `query` callback — the same shape
 * `Collection.include('rel', refineFn)` accepts. Lets consumers chain
 * `.where(...).orderBy(...).take(...)` against the relation collection
 * exactly as they'd write it directly against the orm-client; no
 * structural-literal `{ where, orderBy, take }` shape from plugin-prisma's
 * Prisma-input-tree heritage.
 */
type RelationCollectionFor<
  Types extends SchemaTypes,
  ModelName extends string,
  RelName extends string,
> = Types['PrismaNextContract'] extends Contract<SqlStorage>
  ? IncludeRefinementCollection<
      Types['PrismaNextContract'],
      RelatedModelName<Types['PrismaNextContract'], ModelName, RelName> & string,
      DefaultModelRow<
        Types['PrismaNextContract'],
        RelatedModelName<Types['PrismaNextContract'], ModelName, RelName> & string
      >,
      DefaultCollectionTypeState,
      IsToManyRelation<Types['PrismaNextContract'], ModelName, RelName> extends infer M extends
        boolean
        ? M
        : false
    >
  : never;

type RelationRefineResult<
  Types extends SchemaTypes,
  ModelName extends string,
  RelName extends string,
> = Types['PrismaNextContract'] extends Contract<SqlStorage>
  ? IncludeRefinementResult<
      Types['PrismaNextContract'],
      RelatedModelName<Types['PrismaNextContract'], ModelName, RelName> & string,
      IsToManyRelation<Types['PrismaNextContract'], ModelName, RelName> extends infer M extends
        boolean
        ? M
        : false
    >
  : unknown;

/**
 * `prismaObject(...)` returns this typed ref so consumers can capture
 * it for use in interfaces, recursive types, or `t.prismaField({ type: ref })`.
 * Module-level export so `ObjectRef` from `@pothos/core` counts as used
 * at module scope (TS6196 otherwise reports the import as unused —
 * its only other reference is inside `declare global` augmentations,
 * which `noUnusedLocals` discounts).
 */
export type PrismaObjectRefFor<Types extends SchemaTypes, ModelName extends string> = ObjectRef<
  Types,
  RowFor<Types, ModelName>
>;

/**
 * Mirror of Pothos's `ObjectFieldOptions` generic constraints
 * (`Type extends TypeParam<Types>`, `Nullable extends FieldNullability<Type>`)
 * so the declaration-merging interface in `declare global` can re-use
 * the same constraint surface without re-inlining `import('@pothos/core')`
 * calls. Also keeps the `TypeParam` / `FieldNullability` imports referenced
 * at module scope.
 */
type ObjectFieldOptionsConstraints<Types extends SchemaTypes> = {
  Type: TypeParam<Types>;
  Nullable: FieldNullability<TypeParam<Types>>;
};
export type PothosFieldOptionsConstraints<Types extends SchemaTypes> =
  ObjectFieldOptionsConstraints<Types>;

declare global {
  export namespace PothosSchemaTypes {
    export interface Plugins<Types extends SchemaTypes> {
      prismaNext: PothosPrismaNextPlugin<Types>;
    }

    /**
     * `select` on `t.field` — declare which parent-row columns a computed
     * resolver depends on. The auto-include walker unions every field's
     * `select` into the parent collection's `.select(...)`. Inside
     * `prismaObject`, `ParentShape` is the model's `DefaultModelRow` so
     * the keys autocomplete to actual column names.
     *
     * Outside a prismaObject this still typechecks but the walker ignores
     * non-prisma-next types, so it's a no-op.
     */
    export interface ObjectFieldOptions<
      Types extends SchemaTypes,
      ParentShape,
      Type extends TypeParam<Types>,
      // biome-ignore lint/correctness/noUnusedVariables: required to mirror Pothos's signature for declaration merging
      Nullable extends FieldNullability<Type>,
      // biome-ignore lint/correctness/noUnusedVariables: required to mirror Pothos's signature for declaration merging
      Args extends InputFieldMap,
      // biome-ignore lint/correctness/noUnusedVariables: required to mirror Pothos's signature for declaration merging
      ResolveReturnShape,
    > {
      select?: {
        [K in keyof ParentShape]?: true;
      };
    }

    export interface UserSchemaTypes {
      PrismaNextContract: Contract<SqlStorage>;
    }

    export interface ExtendDefaultTypes<PartialTypes extends Partial<UserSchemaTypes>> {
      PrismaNextContract: undefined extends PartialTypes['PrismaNextContract']
        ? Contract<SqlStorage>
        : PartialTypes['PrismaNextContract'] & object;
    }

    export interface SchemaBuilderOptions<Types extends SchemaTypes> {
      // Types is reachable as PothosSchemaTypes via the augmentation
      // mechanism; we keep `Contract<SqlStorage>` as a permissive default
      // rather than threading the per-builder PrismaNextContract through.
      prismaNext: PrismaNextPluginOptions<Contract<SqlStorage>> & { _types?: Types };
    }

    export interface SchemaBuilder<Types extends SchemaTypes> {
      prismaObject<ModelName extends string>(
        modelName: ModelName,
        options: PrismaNextObjectTypeOptions<Types, ModelName>,
      ): PrismaObjectRefFor<Types, ModelName>;
    }

    export interface RootFieldBuilder<
      Types extends SchemaTypes,
      ParentShape,
      Kind extends FieldKind,
    > {
      prismaField<ModelName extends string, Args extends InputFieldMap>(
        options: PrismaNextRootFieldOptions<Types, ParentShape, ModelName, Args, Kind>,
      ): FieldRef<Types, unknown>;
    }
  }
}

/**
 * Per-model field builder. Pothos's `ObjectFieldBuilder` parameterises
 * on `ParentShape` (a structural type) but not on the *model name*,
 * which is what we need to constrain `relation`'s arguments to the
 * contract's actual relation names. So `prismaObject` types its
 * `fields(t)` callback against this interface instead of the global
 * `ObjectFieldBuilder`. The runtime class
 * (`PrismaNextObjectFieldBuilder` in `prisma-object-field-builder.ts`)
 * extends `ObjectFieldBuilder` so all of Pothos's stock methods —
 * `t.field`, `t.exposeID`, `t.string`, etc. — flow through unchanged.
 */
export interface PrismaNextObjectFieldBuilderShape<
  Types extends SchemaTypes,
  ModelName extends string,
> extends PothosSchemaTypes.ObjectFieldBuilder<Types, RowFor<Types, ModelName>> {
  relation<
    RelName extends RelationsOnModel<Types, ModelName>,
    Args extends InputFieldMap = Record<never, never>,
  >(
    name: RelName,
    options?: PrismaNextRelationOptions<Types, ModelName, RelName & string, Args>,
  ): FieldRef<Types, unknown>;
  relationCount<
    RelName extends RelationsOnModel<Types, ModelName>,
    Args extends InputFieldMap = Record<never, never>,
  >(name: RelName, options?: PrismaNextRelationCountOptions<Types, Args>): FieldRef<Types, number>;
}

interface PrismaNextObjectTypeOptions<Types extends SchemaTypes, ModelName extends string> {
  description?: string;
  fields?: (
    t: PrismaNextObjectFieldBuilderShape<Types, ModelName>,
  ) => Record<string, FieldRef<Types, unknown>>;
}

interface PrismaNextRootFieldOptions<
  Types extends SchemaTypes,
  ParentShape,
  ModelName extends string,
  Args extends InputFieldMap,
  Kind extends FieldKind,
> {
  type: ModelName;
  description?: string;
  nullable?: boolean;
  args?: Args;
  // Phantom slot so Kind is referenced (Pothos's RootFieldBuilder
  // declares Kind; we mirror it for declaration merging without using
  // it in the runtime resolver).
  _kind?: Kind;
  resolve: (
    collection: Types['PrismaNextContract'] extends Contract<SqlStorage>
      ? Collection<Types['PrismaNextContract'], ModelName>
      : Collection<Contract<SqlStorage>, ModelName>,
    parent: ParentShape,
    args: InputShapeFromFields<Args>,
    context: Types['Context'],
    info: GraphQLResolveInfo,
  ) => MaybePromise<unknown>;
}

interface PrismaNextRelationOptions<
  Types extends SchemaTypes,
  ModelName extends string,
  RelName extends string,
  Args extends InputFieldMap,
> {
  description?: string;
  nullable?: boolean;
  args?: Args;
  /**
   * Fluent refiner. Receives the relation's collection (the same shape
   * `db.Parent.include('rel', refineFn)` exposes — chainable
   * `.where(...).orderBy(...).take(...)` etc.) along with the field's
   * resolved `args` and the request `ctx`, and returns the refined
   * collection. Plugin-prisma's structural `query: { where, orderBy }`
   * literal would mismatch prisma-next's fluent API; this matches it
   * directly so consumers write the same idiom they'd write inline.
   */
  query?: (
    rel: RelationCollectionFor<Types, ModelName, RelName>,
    args: InputShapeFromFields<Args>,
    ctx: Types['Context'],
  ) => RelationRefineResult<Types, ModelName, RelName>;
}

interface PrismaNextRelationCountOptions<Types extends SchemaTypes, Args extends InputFieldMap> {
  description?: string;
  args?: Args;
  // `where` here filters which related rows the count includes. Typed
  // permissively for now — counting through the relation is rarer than
  // .relation's where, and the orm-client surface for branch-where on
  // a count is in flux.
  where?: unknown | ((args: InputShapeFromFields<Args>, ctx: Types['Context']) => unknown);
}
