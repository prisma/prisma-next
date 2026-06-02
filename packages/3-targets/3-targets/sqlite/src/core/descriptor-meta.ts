import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { CodecTypes } from '../exports/codec-types';
import { sqliteAuthoringFieldPresets } from './authoring';

const sqliteTargetDescriptorMetaBase = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: UNBOUND_NAMESPACE_ID,
  authoring: {
    field: sqliteAuthoringFieldPresets,
  },
} as const;

export const sqliteTargetDescriptorMeta: typeof sqliteTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = sqliteTargetDescriptorMetaBase;
