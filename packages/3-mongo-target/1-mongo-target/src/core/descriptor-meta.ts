import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { CodecTypes } from './codec-types';

const mongoTargetDescriptorMetaBase = {
  kind: 'target',
  familyId: 'mongo',
  targetId: 'mongo',
  id: 'mongo',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: UNBOUND_NAMESPACE_ID,
} as const;

export const mongoTargetDescriptorMeta: typeof mongoTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = mongoTargetDescriptorMetaBase;
