import type { CodecControlHooks, ExpandNativeTypeInput } from '@prisma-next/family-sql/control';
import type { AnyExpression } from '@prisma-next/sql-relational-core/ast';
import { LiteralExpr } from '@prisma-next/sql-relational-core/ast';
import {
  buildOperation,
  type CodecExpression,
  type CodecIdsWithTrait,
  type CodecValue,
  codecOf,
  type Expression,
  type ScalarListExpression,
  type TraitExpression,
  toExpr,
} from '@prisma-next/sql-relational-core/expression';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_BYTEA_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_FLOAT_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INT_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_UUID_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_TIMESTAMP_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '@prisma-next/target-postgres/codec-ids';
import { postgresCodecRegistry } from '@prisma-next/target-postgres/codecs';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import type { QueryOperationTypes } from '../types/operation-types';

// ============================================================================ Helper functions for reducing boilerplate ============================================================================

/** Creates a type import spec for codec types */
const codecTypeImport = (named: string) =>
  ({
    package: '@prisma-next/target-postgres/codec-types',
    named,
    alias: named,
  }) as const;

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function expandLength({ nativeType, typeParams }: ExpandNativeTypeInput): string {
  if (!typeParams || !('length' in typeParams)) {
    return nativeType;
  }
  const length = typeParams['length'];
  if (!isPositiveInteger(length)) {
    throw new Error(
      `Invalid "length" type parameter for "${nativeType}": expected a positive integer, got ${JSON.stringify(length)}`,
    );
  }
  return `${nativeType}(${length})`;
}

function expandPrecision({ nativeType, typeParams }: ExpandNativeTypeInput): string {
  if (!typeParams || !('precision' in typeParams)) {
    return nativeType;
  }
  const precision = typeParams['precision'];
  if (!isPositiveInteger(precision)) {
    throw new Error(
      `Invalid "precision" type parameter for "${nativeType}": expected a positive integer, got ${JSON.stringify(precision)}`,
    );
  }
  return `${nativeType}(${precision})`;
}

function expandNumeric({ nativeType, typeParams }: ExpandNativeTypeInput): string {
  const hasPrecision = typeParams && 'precision' in typeParams;
  const hasScale = typeParams && 'scale' in typeParams;

  if (!hasPrecision && !hasScale) {
    return nativeType;
  }

  if (!hasPrecision && hasScale) {
    throw new Error(
      `Invalid type parameters for "${nativeType}": "scale" requires "precision" to be specified`,
    );
  }

  if (hasPrecision) {
    const precision = typeParams['precision'];
    if (!isPositiveInteger(precision)) {
      throw new Error(
        `Invalid "precision" type parameter for "${nativeType}": expected a positive integer, got ${JSON.stringify(precision)}`,
      );
    }
    if (hasScale) {
      const scale = typeParams['scale'];
      if (!isNonNegativeInteger(scale)) {
        throw new Error(
          `Invalid "scale" type parameter for "${nativeType}": expected a non-negative integer, got ${JSON.stringify(scale)}`,
        );
      }
      return `${nativeType}(${precision},${scale})`;
    }
    return `${nativeType}(${precision})`;
  }

  return nativeType;
}

const lengthHooks: CodecControlHooks = { expandNativeType: expandLength };
const precisionHooks: CodecControlHooks = { expandNativeType: expandPrecision };
const numericHooks: CodecControlHooks = { expandNativeType: expandNumeric };
const identityHooks: CodecControlHooks = { expandNativeType: ({ nativeType }) => nativeType };

// ============================================================================ Descriptor metadata ============================================================================

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

/**
 * Lower a whole-array operand for the array filter ops. A raw JS array renders
 * as a `ARRAY[...]` literal; a list expression (another list column) is lowered
 * through its own AST.
 */
function arrayOperandToExpr(operand: unknown): AnyExpression {
  return Array.isArray(operand) ? LiteralExpr.of(operand) : toExpr(operand);
}

/** Element {@link CodecRef} for a list receiver, preserving type params when present. */
function elementCodecOf(self: unknown) {
  const listCodec = codecOf(self);
  if (listCodec === undefined) return undefined;
  return listCodec.typeParams === undefined
    ? { codecId: listCodec.codecId }
    : { codecId: listCodec.codecId, typeParams: listCodec.typeParams };
}

export function postgresQueryOperations<CT extends CodecTypesBase>(): QueryOperationTypes<CT> {
  return {
    ilike: {
      self: { traits: ['textual'] },
      impl: (
        self: TraitExpression<readonly ['textual'], false, CT>,
        pattern: CodecExpression<'pg/text@1', false, CT>,
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'ilike',
          args: [toExpr(self), toExpr(pattern, { codecId: PG_TEXT_CODEC_ID })],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} ILIKE {{arg0}}' },
        });
      },
    },
    has: {
      self: { many: true, elementTraits: ['equality'] },
      impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        elem: CodecExpression<CodecId, false, CT>,
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        const listCodec = codecOf(self);
        const elementCodec =
          listCodec === undefined
            ? undefined
            : listCodec.typeParams === undefined
              ? { codecId: listCodec.codecId }
              : { codecId: listCodec.codecId, typeParams: listCodec.typeParams };
        return buildOperation({
          method: 'has',
          args: [toExpr(self), toExpr(elem, elementCodec)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'infix',
            template: '{{arg0}} = ANY({{self}})',
          },
        });
      },
    },
    arrayContains: {
      self: { many: true, elementTraits: ['equality'] },
      impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        other: readonly CodecValue<CodecId, false, CT>[] | ScalarListExpression<CodecId, false>,
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'arrayContains',
          args: [toExpr(self), arrayOperandToExpr(other)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} @> {{arg0}}' },
        });
      },
    },
    containedBy: {
      self: { many: true, elementTraits: ['equality'] },
      impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        other: readonly CodecValue<CodecId, false, CT>[] | ScalarListExpression<CodecId, false>,
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'containedBy',
          args: [toExpr(self), arrayOperandToExpr(other)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} <@ {{arg0}}' },
        });
      },
    },
    overlaps: {
      self: { many: true, elementTraits: ['equality'] },
      impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        other: readonly CodecValue<CodecId, false, CT>[] | ScalarListExpression<CodecId, false>,
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'overlaps',
          args: [toExpr(self), arrayOperandToExpr(other)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} && {{arg0}}' },
        });
      },
    },
    eq: {
      self: { many: true, elementTraits: ['equality'] },
      impl: <CodecId extends CodecIdsWithTrait<CT, ['equality']>>(
        self: ScalarListExpression<CodecId, false>,
        other: ScalarListExpression<CodecId, false> | readonly CodecValue<CodecId, false, CT>[],
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'eq',
          args: [toExpr(self), arrayOperandToExpr(other)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} = {{arg0}}' },
        });
      },
    },
    ne: {
      self: { many: true, elementTraits: ['equality'] },
      impl: <CodecId extends CodecIdsWithTrait<CT, ['equality']>>(
        self: ScalarListExpression<CodecId, false>,
        other: ScalarListExpression<CodecId, false> | readonly CodecValue<CodecId, false, CT>[],
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'ne',
          args: [toExpr(self), arrayOperandToExpr(other)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} <> {{arg0}}' },
        });
      },
    },
    gt: {
      self: { many: true, elementTraits: ['order'] },
      impl: <CodecId extends CodecIdsWithTrait<CT, ['order']>>(
        self: ScalarListExpression<CodecId, false>,
        other: ScalarListExpression<CodecId, false> | readonly CodecValue<CodecId, false, CT>[],
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'gt',
          args: [toExpr(self), arrayOperandToExpr(other)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} > {{arg0}}' },
        });
      },
    },
    lt: {
      self: { many: true, elementTraits: ['order'] },
      impl: <CodecId extends CodecIdsWithTrait<CT, ['order']>>(
        self: ScalarListExpression<CodecId, false>,
        other: ScalarListExpression<CodecId, false> | readonly CodecValue<CodecId, false, CT>[],
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'lt',
          args: [toExpr(self), arrayOperandToExpr(other)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} < {{arg0}}' },
        });
      },
    },
    gte: {
      self: { many: true, elementTraits: ['order'] },
      impl: <CodecId extends CodecIdsWithTrait<CT, ['order']>>(
        self: ScalarListExpression<CodecId, false>,
        other: ScalarListExpression<CodecId, false> | readonly CodecValue<CodecId, false, CT>[],
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'gte',
          args: [toExpr(self), arrayOperandToExpr(other)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} >= {{arg0}}' },
        });
      },
    },
    lte: {
      self: { many: true, elementTraits: ['order'] },
      impl: <CodecId extends CodecIdsWithTrait<CT, ['order']>>(
        self: ScalarListExpression<CodecId, false>,
        other: ScalarListExpression<CodecId, false> | readonly CodecValue<CodecId, false, CT>[],
      ): Expression<{ codecId: 'pg/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'lte',
          args: [toExpr(self), arrayOperandToExpr(other)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} <= {{arg0}}' },
        });
      },
    },
    length: {
      self: { many: true },
      impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
      ): Expression<{ codecId: 'pg/int4@1'; nullable: false }> => {
        return buildOperation({
          method: 'length',
          args: [toExpr(self)],
          returns: { codecId: PG_INT4_CODEC_ID, nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'cardinality({{self}})',
          },
        });
      },
    },
    index: {
      self: { many: true },
      impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        i: CodecExpression<'pg/int4@1', false, CT>,
      ): Expression<{ codecId: CodecId; nullable: true }> => {
        const listCodec = codecOf(self);
        const elementCodec =
          listCodec === undefined
            ? undefined
            : listCodec.typeParams === undefined
              ? { codecId: listCodec.codecId }
              : { codecId: listCodec.codecId, typeParams: listCodec.typeParams };
        return buildOperation<{ codecId: CodecId; nullable: true }>({
          method: 'index',
          args: [toExpr(self), toExpr(i, { codecId: PG_INT4_CODEC_ID })],
          returns: {
            codecId: blindCast<
              CodecId,
              "the element codecId resolved from the list receiver's own codec is, by construction, this op's declared element CodecId; the runtime string can't be tied back to the generic"
            >(listCodec?.codecId),
            nullable: true,
            ...ifDefined('codec', elementCodec),
          },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}}[{{arg0}}]' },
        });
      },
    },
    arrayAppend: {
      self: { many: true, elementTraits: ['equality'] },
      impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        elem: CodecExpression<CodecId, false, CT>,
      ): Expression<{ codecId: CodecId; nullable: false; many: true }> => {
        const elementCodec = elementCodecOf(self);
        return buildOperation<{ codecId: CodecId; nullable: false; many: true }>({
          method: 'arrayAppend',
          args: [toExpr(self), toExpr(elem, elementCodec)],
          returns: {
            codecId: blindCast<
              CodecId,
              "the element codecId resolved from the list receiver's own codec is, by construction, this op's declared element CodecId; the runtime string can't be tied back to the generic"
            >(codecOf(self)?.codecId),
            nullable: false,
            many: true,
            ...ifDefined('codec', elementCodec),
          },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'array_append({{self}}, {{arg0}})',
          },
        });
      },
    },
    arrayRemove: {
      self: { many: true, elementTraits: ['equality'] },
      impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        elem: CodecExpression<CodecId, false, CT>,
      ): Expression<{ codecId: CodecId; nullable: false; many: true }> => {
        const elementCodec = elementCodecOf(self);
        return buildOperation<{ codecId: CodecId; nullable: false; many: true }>({
          method: 'arrayRemove',
          args: [toExpr(self), toExpr(elem, elementCodec)],
          returns: {
            codecId: blindCast<
              CodecId,
              "the element codecId resolved from the list receiver's own codec is, by construction, this op's declared element CodecId; the runtime string can't be tied back to the generic"
            >(codecOf(self)?.codecId),
            nullable: false,
            many: true,
            ...ifDefined('codec', elementCodec),
          },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'array_remove({{self}}, {{arg0}})',
          },
        });
      },
    },
  };
}

export const postgresAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      orderBy: true,
      limit: true,
      lateral: true,
      jsonAgg: true,
      returning: true,
      distinctOn: true,
    },
    sql: {
      enums: true,
      returning: true,
      defaultInInsert: true,
      lateral: true,
      scalarList: true,
    },
  },
  types: {
    codecTypes: {
      codecDescriptors: Array.from(postgresCodecRegistry.values()),
      import: {
        package: '@prisma-next/target-postgres/codec-types',
        named: 'CodecTypes',
        alias: 'PgTypes',
      },
      typeImports: [
        {
          package: '@prisma-next/target-postgres/codec-types',
          named: 'JsonValue',
          alias: 'JsonValue',
        },
        codecTypeImport('Char'),
        codecTypeImport('Varchar'),
        codecTypeImport('Numeric'),
        codecTypeImport('Bit'),
        codecTypeImport('VarBit'),
        codecTypeImport('Timestamp'),
        codecTypeImport('Timestamptz'),
        codecTypeImport('Time'),
        codecTypeImport('Timetz'),
        codecTypeImport('Interval'),
      ],
      controlPlaneHooks: {
        [SQL_CHAR_CODEC_ID]: lengthHooks,
        [SQL_VARCHAR_CODEC_ID]: lengthHooks,
        [SQL_TIMESTAMP_CODEC_ID]: precisionHooks,
        [PG_CHAR_CODEC_ID]: lengthHooks,
        [PG_VARCHAR_CODEC_ID]: lengthHooks,
        [PG_NUMERIC_CODEC_ID]: numericHooks,
        [PG_BIT_CODEC_ID]: lengthHooks,
        [PG_VARBIT_CODEC_ID]: lengthHooks,
        [PG_TIMESTAMP_CODEC_ID]: precisionHooks,
        [PG_TIMESTAMPTZ_CODEC_ID]: precisionHooks,
        [PG_TIME_CODEC_ID]: precisionHooks,
        [PG_TIMETZ_CODEC_ID]: precisionHooks,
        [PG_INTERVAL_CODEC_ID]: precisionHooks,
        [PG_JSON_CODEC_ID]: identityHooks,
        [PG_JSONB_CODEC_ID]: identityHooks,
        [PG_BYTEA_CODEC_ID]: identityHooks,
        [PG_UUID_CODEC_ID]: identityHooks,
      },
    },
    storage: [
      { typeId: PG_TEXT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'text' },
      { typeId: SQL_TEXT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'text' },
      { typeId: SQL_CHAR_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'character' },
      {
        typeId: SQL_VARCHAR_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'character varying',
      },
      { typeId: SQL_INT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int4' },
      { typeId: SQL_FLOAT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'float8' },
      {
        typeId: SQL_TIMESTAMP_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'timestamp',
      },
      { typeId: PG_CHAR_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'character' },
      {
        typeId: PG_VARCHAR_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'character varying',
      },
      { typeId: PG_INT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int4' },
      { typeId: PG_FLOAT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'float8' },
      { typeId: PG_INT4_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int4' },
      { typeId: PG_INT2_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int2' },
      { typeId: PG_INT8_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'int8' },
      { typeId: PG_FLOAT4_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'float4' },
      { typeId: PG_FLOAT8_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'float8' },
      { typeId: PG_NUMERIC_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'numeric' },
      {
        typeId: PG_TIMESTAMP_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'timestamp',
      },
      {
        typeId: PG_TIMESTAMPTZ_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'timestamptz',
      },
      { typeId: PG_TIME_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'time' },
      { typeId: PG_TIMETZ_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'timetz' },
      { typeId: PG_BOOL_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'bool' },
      { typeId: PG_BIT_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'bit' },
      {
        typeId: PG_VARBIT_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'bit varying',
      },
      {
        typeId: PG_INTERVAL_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'interval',
      },
      { typeId: PG_JSON_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'json' },
      { typeId: PG_JSONB_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'jsonb' },
      { typeId: PG_BYTEA_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'bytea' },
      { typeId: PG_UUID_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'uuid' },
    ],
    queryOperationTypes: {
      import: {
        package: '@prisma-next/adapter-postgres/operation-types',
        named: 'QueryOperationTypes',
        alias: 'PgAdapterQueryOps',
      },
    },
  },
} as const;
