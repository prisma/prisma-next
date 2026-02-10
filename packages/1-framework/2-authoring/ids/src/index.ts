import type {
  ExecutionMutationDefaultValue,
  GeneratedValueSpec,
} from '@prisma-next/contract/types';
import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import { ifDefined } from '@prisma-next/utils/defined';
import type { IdGeneratorOptionsById } from './generators';

type GeneratedColumnDescriptor = {
  readonly type: ColumnTypeDescriptor;
  readonly typeParams?: Record<string, unknown>;
};

/**
 * Note: we're going to update `pg/text` to a more generic `sql/char` type once
 * https://github.com/prisma/prisma-next/pull/139/ lands in `main`.
 */
const generatedColumnDescriptors: Record<GeneratedValueSpec['id'], GeneratedColumnDescriptor> = {
  ulid: {
    type: { codecId: 'pg/text@1', nativeType: 'text' },
  },
  nanoid: {
    type: { codecId: 'pg/text@1', nativeType: 'text' },
  },
  uuidv7: {
    type: { codecId: 'pg/text@1', nativeType: 'text' },
  },
  uuidv4: {
    type: { codecId: 'pg/text@1', nativeType: 'text' },
  },
  cuid2: {
    type: { codecId: 'pg/text@1', nativeType: 'text' },
  },
  ksuid: {
    type: { codecId: 'pg/text@1', nativeType: 'text' },
  },
};

export type GeneratedColumnSpec = {
  readonly type: ColumnTypeDescriptor;
  readonly nullable?: false;
  readonly typeParams?: Record<string, unknown>;
  readonly generated: ExecutionMutationDefaultValue;
};

function createGeneratedSpec<TId extends GeneratedValueSpec['id']>(
  id: TId,
  options?: IdGeneratorOptionsById[TId],
): GeneratedColumnSpec {
  const { type, typeParams } = generatedColumnDescriptors[id];
  const params = options as Record<string, unknown> | undefined;
  return {
    type,
    nullable: false,
    ...ifDefined('typeParams', typeParams),
    generated: {
      kind: 'generator',
      id,
      ...ifDefined('params', params),
    },
  };
}

export const ulid = (options?: IdGeneratorOptionsById['ulid']): GeneratedColumnSpec =>
  createGeneratedSpec('ulid', options);
export const nanoid = (options?: IdGeneratorOptionsById['nanoid']): GeneratedColumnSpec =>
  createGeneratedSpec('nanoid', options);
export const uuidv7 = (options?: IdGeneratorOptionsById['uuidv7']): GeneratedColumnSpec =>
  createGeneratedSpec('uuidv7', options);
export const uuidv4 = (options?: IdGeneratorOptionsById['uuidv4']): GeneratedColumnSpec =>
  createGeneratedSpec('uuidv4', options);
export const cuid2 = (options?: IdGeneratorOptionsById['cuid2']): GeneratedColumnSpec =>
  createGeneratedSpec('cuid2', options);
export const ksuid = (options?: IdGeneratorOptionsById['ksuid']): GeneratedColumnSpec =>
  createGeneratedSpec('ksuid', options);
