import type { ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  type BuiltinGeneratorId,
  builtinGeneratorIds as builtinGeneratorIdsInternal,
  type IdGeneratorOptionsById,
} from './generators';

export const builtinGeneratorIds = builtinGeneratorIdsInternal;

export type GeneratedColumnDescriptor = {
  readonly type: ColumnTypeDescriptor;
  readonly typeParams?: Record<string, unknown>;
};

type BuiltinGeneratorMetadata = {
  readonly applicableCodecIds: readonly string[];
  readonly generatedColumnDescriptor: GeneratedColumnDescriptor;
  readonly resolveGeneratedColumnDescriptor?: (
    params?: Record<string, unknown>,
  ) => GeneratedColumnDescriptor;
};

function resolveNanoidColumnDescriptor(
  params?: Record<string, unknown>,
): GeneratedColumnDescriptor {
  const rawSize = params?.['size'];
  const length =
    typeof rawSize === 'number' && Number.isInteger(rawSize) && rawSize >= 2 && rawSize <= 255
      ? rawSize
      : 21;
  return {
    type: { codecId: 'sql/char@1', nativeType: 'character' },
    typeParams: { length },
  };
}

const builtinGeneratorMetadataById: Record<BuiltinGeneratorId, BuiltinGeneratorMetadata> = {
  ulid: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1'],
    generatedColumnDescriptor: {
      type: { codecId: 'sql/char@1', nativeType: 'character' },
      typeParams: { length: 26 },
    },
  },
  nanoid: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1'],
    generatedColumnDescriptor: {
      type: { codecId: 'sql/char@1', nativeType: 'character' },
      typeParams: { length: 21 },
    },
    resolveGeneratedColumnDescriptor: resolveNanoidColumnDescriptor,
  },
  uuidv7: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1'],
    generatedColumnDescriptor: {
      type: { codecId: 'sql/char@1', nativeType: 'character' },
      typeParams: { length: 36 },
    },
  },
  uuidv4: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1'],
    generatedColumnDescriptor: {
      type: { codecId: 'sql/char@1', nativeType: 'character' },
      typeParams: { length: 36 },
    },
  },
  cuid2: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1'],
    generatedColumnDescriptor: {
      type: { codecId: 'sql/char@1', nativeType: 'character' },
      typeParams: { length: 24 },
    },
  },
  ksuid: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1'],
    generatedColumnDescriptor: {
      type: { codecId: 'sql/char@1', nativeType: 'character' },
      typeParams: { length: 27 },
    },
  },
};

export const builtinGeneratorRegistryMetadata: ReadonlyArray<{
  readonly id: BuiltinGeneratorId;
  readonly applicableCodecIds: readonly string[];
}> = builtinGeneratorIds.map((id) => ({
  id,
  applicableCodecIds: builtinGeneratorMetadataById[id].applicableCodecIds,
}));

export function resolveBuiltinGeneratedColumnDescriptor(input: {
  readonly id: BuiltinGeneratorId;
  readonly params?: Record<string, unknown>;
}): GeneratedColumnDescriptor {
  const metadata = builtinGeneratorMetadataById[input.id];
  const resolver = metadata.resolveGeneratedColumnDescriptor;
  if (resolver) {
    return resolver(input.params);
  }
  return metadata.generatedColumnDescriptor;
}

export type GeneratedColumnSpec = {
  readonly type: ColumnTypeDescriptor;
  readonly nullable?: false;
  readonly typeParams?: Record<string, unknown>;
  readonly generated: ExecutionMutationDefaultValue;
};

function createGeneratedSpec<TId extends BuiltinGeneratorId>(
  id: TId,
  options?: IdGeneratorOptionsById[TId],
): GeneratedColumnSpec {
  const params = options as Record<string, unknown> | undefined;
  const resolvedDescriptor = resolveBuiltinGeneratedColumnDescriptor({
    id,
    ...ifDefined('params', params),
  });
  return {
    type: resolvedDescriptor.type,
    nullable: false,
    ...ifDefined('typeParams', resolvedDescriptor.typeParams),
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
