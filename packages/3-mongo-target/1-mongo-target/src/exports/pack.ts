import { mongoTargetDescriptorMeta } from '../core/descriptor-meta';
import type { CodecTypes } from './codec-types';

const mongoTargetPack: {
  readonly kind: 'target';
  readonly familyId: 'mongo';
  readonly targetId: 'mongo';
  readonly id: 'mongo';
  readonly version: '0.0.1';
  readonly capabilities: Record<string, never>;
  readonly __codecTypes?: CodecTypes;
} = mongoTargetDescriptorMeta;

export default mongoTargetPack;
