import { mongoCodecDescriptors } from '@prisma-next/adapter-mongo/codecs';
import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { CodecTypes } from './codec-types';

// The Mongo target owns its codec descriptors. Contract authoring resolves each enum's codec by id
// from this list (via `extractCodecLookup`) to encode member values, so the target pack is the sole
// contributor of these codecs to the composed control stack.
const mongoTargetDescriptorMetaBase = {
  kind: 'target',
  familyId: 'mongo',
  targetId: 'mongo',
  id: 'mongo',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: UNBOUND_NAMESPACE_ID,
  types: {
    codecTypes: {
      codecDescriptors: mongoCodecDescriptors,
    },
  },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

export const mongoTargetDescriptorMeta: typeof mongoTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = mongoTargetDescriptorMetaBase;
