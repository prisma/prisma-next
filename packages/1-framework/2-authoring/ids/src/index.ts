import type { ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type { ColumnTypeDescriptor } from '@prisma-next/framework-components/codec';
import { ifDefined } from '@prisma-next/utils/defined';
import { type BuiltinGeneratorId, builtinGeneratorIds } from './generator-ids';
import type { IdGeneratorOptionsById } from './generators';

export { builtinGeneratorIds };

type BuiltinGeneratorMetadata = {
  readonly applicableCodecIds: readonly string[];
};

const builtinGeneratorMetadataById = {
  ulid: { applicableCodecIds: ['pg/text@1', 'sql/char@1'] },
  nanoid: { applicableCodecIds: ['pg/text@1', 'sql/char@1'] },
  uuidv7: { applicableCodecIds: ['pg/text@1', 'sql/char@1', 'pg/uuid@1'] },
  uuidv4: { applicableCodecIds: ['pg/text@1', 'sql/char@1', 'pg/uuid@1'] },
  cuid2: { applicableCodecIds: ['pg/text@1', 'sql/char@1'] },
  ksuid: { applicableCodecIds: ['pg/text@1', 'sql/char@1'] },
} as const satisfies Record<BuiltinGeneratorId, BuiltinGeneratorMetadata>;

export const builtinGeneratorRegistryMetadata: ReadonlyArray<{
  readonly id: BuiltinGeneratorId;
  readonly applicableCodecIds: readonly string[];
}> = builtinGeneratorIds.map((id) => ({
  id,
  applicableCodecIds: builtinGeneratorMetadataById[id].applicableCodecIds,
}));

export type GeneratedColumnSpec<TCodecId extends string = string> = {
  readonly type: ColumnTypeDescriptor<TCodecId>;
  readonly nullable?: false;
  readonly typeParams?: Record<string, unknown>;
  readonly generated: ExecutionMutationDefaultValue;
};

/**
 * The explicit column storage each TS spec helper bundles: a `character(N)`
 * column sized to the generator's output. Calling a helper *is* an explicit
 * storage request (the storage is part of the helper's contract), unlike a
 * PSL `@default(<generator>)`, which never influences the column type.
 */
const CHAR_COLUMN_TYPE = { codecId: 'sql/char@1', nativeType: 'character' } as const;

const specCharLengthById: Record<Exclude<BuiltinGeneratorId, 'nanoid'>, number> = {
  ulid: 26,
  uuidv7: 36,
  uuidv4: 36,
  cuid2: 24,
  ksuid: 27,
};

function specCharLength(id: BuiltinGeneratorId, params?: Record<string, unknown>): number {
  if (id !== 'nanoid') {
    return specCharLengthById[id];
  }
  const rawSize = params?.['size'];
  if (rawSize === undefined) {
    return 21;
  }
  if (typeof rawSize !== 'number' || !Number.isInteger(rawSize) || rawSize < 2 || rawSize > 255) {
    throw new Error('nanoid size must be an integer between 2 and 255');
  }
  return rawSize;
}

function createGeneratedSpec<TId extends BuiltinGeneratorId>(
  id: TId,
  options?: IdGeneratorOptionsById[TId],
): GeneratedColumnSpec<typeof CHAR_COLUMN_TYPE.codecId> {
  const params = options as Record<string, unknown> | undefined;
  return {
    type: CHAR_COLUMN_TYPE,
    nullable: false,
    typeParams: { length: specCharLength(id, params) },
    generated: {
      kind: 'generator',
      id,
      ...ifDefined('params', params),
    },
  };
}

export const ulid = (options?: IdGeneratorOptionsById['ulid']) =>
  createGeneratedSpec('ulid', options);
export const nanoid = (options?: IdGeneratorOptionsById['nanoid']) =>
  createGeneratedSpec('nanoid', options);
export const uuidv7 = (options?: IdGeneratorOptionsById['uuidv7']) =>
  createGeneratedSpec('uuidv7', options);
export const uuidv4 = (options?: IdGeneratorOptionsById['uuidv4']) =>
  createGeneratedSpec('uuidv4', options);
export const cuid2 = (options?: IdGeneratorOptionsById['cuid2']) =>
  createGeneratedSpec('cuid2', options);
export const ksuid = (options?: IdGeneratorOptionsById['ksuid']) =>
  createGeneratedSpec('ksuid', options);
