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

const generatedColumnDescriptors: Record<GeneratedValueSpec['id'], GeneratedColumnDescriptor> = {
  ulid: {
    type: { codecId: 'sql/char@1', nativeType: 'character' },
    typeParams: { length: 26 },
  },
  nanoid: {
    type: { codecId: 'sql/char@1', nativeType: 'character' },
    typeParams: { length: 21 },
  },
  uuidv7: {
    type: { codecId: 'sql/char@1', nativeType: 'character' },
    typeParams: { length: 36 },
  },
  uuidv4: {
    type: { codecId: 'sql/char@1', nativeType: 'character' },
    typeParams: { length: 36 },
  },
  cuid2: {
    type: { codecId: 'sql/char@1', nativeType: 'character' },
    typeParams: { length: 24 },
  },
  ksuid: {
    type: { codecId: 'sql/char@1', nativeType: 'character' },
    typeParams: { length: 27 },
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
  const { type } = generatedColumnDescriptors[id];
  const typeParams =
    id === 'nanoid' &&
    typeof options === 'object' &&
    options !== null &&
    'size' in options &&
    typeof options.size === 'number'
      ? { length: options.size }
      : generatedColumnDescriptors[id].typeParams;
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
