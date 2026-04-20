import type { CodecTypes } from '@prisma-next/adapter-sqlite/codec-types';

const sqliteTargetDescriptorMetaBase = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {},
} as const;

export const sqliteTargetDescriptorMeta: typeof sqliteTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = sqliteTargetDescriptorMetaBase;
