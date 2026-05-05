import type {
  FieldKind,
  FieldRef,
  InputFieldMap,
  InputShapeFromFields,
  MaybePromise,
  SchemaTypes,
} from '@pothos/core';
import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Collection } from '@prisma-next/sql-orm-client';
import type { GraphQLResolveInfo } from 'graphql';
import type { PothosPrismaNextPlugin } from './index';
import type { PrismaNextPluginOptions } from './types';

/**
 * Type-level surface of the plugin. Kept deliberately loose for the
 * demo — the exposeX / relation / prismaField surfaces use `unknown`
 * generously rather than threading per-model row inference through. A
 * tighter v2 would mirror pothos-prisma's `ShapeFromSelection` and per-
 * model row computation.
 */
declare global {
  export namespace PothosSchemaTypes {
    export interface Plugins<Types extends SchemaTypes> {
      prismaNext: PothosPrismaNextPlugin<Types>;
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
        options: PrismaNextObjectTypeOptions<Types>,
      ): unknown;
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

    export interface ObjectFieldBuilder<Types extends SchemaTypes, ParentShape> {
      relation<RelationName extends string, Args extends InputFieldMap = Record<never, never>>(
        name: RelationName,
        options?: PrismaNextRelationOptions<Types, ParentShape, Args>,
      ): FieldRef<Types, unknown>;
      relationCount<RelationName extends string, Args extends InputFieldMap = Record<never, never>>(
        name: RelationName,
        options?: PrismaNextRelationCountOptions<Types, ParentShape, Args>,
      ): FieldRef<Types, number>;
    }
  }
}

interface PrismaNextObjectTypeOptions<Types extends SchemaTypes> {
  description?: string;
  fields?: (
    t: PothosSchemaTypes.ObjectFieldBuilder<Types, Record<string, unknown>>,
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
    collection: Collection<Contract<SqlStorage>, ModelName>,
    parent: ParentShape,
    args: InputShapeFromFields<Args>,
    context: Types['Context'],
    info: GraphQLResolveInfo,
  ) => MaybePromise<unknown>;
}

interface PrismaNextRelationOptions<
  Types extends SchemaTypes,
  ParentShape,
  Args extends InputFieldMap,
> {
  description?: string;
  nullable?: boolean;
  args?: Args;
  // Phantom slot so ParentShape is referenced.
  _parent?: ParentShape;
  query?:
    | RelationRefine
    | ((args: InputShapeFromFields<Args>, ctx: Types['Context']) => RelationRefine);
}

interface PrismaNextRelationCountOptions<
  Types extends SchemaTypes,
  ParentShape,
  Args extends InputFieldMap,
> {
  description?: string;
  args?: Args;
  _parent?: ParentShape;
  where?: unknown | ((args: InputShapeFromFields<Args>, ctx: Types['Context']) => unknown);
}

interface RelationRefine {
  where?: unknown;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  distinct?: readonly string[];
  distinctOn?: readonly string[];
}
