import { mongoTargetDescriptorMeta } from '../core/descriptor-meta';
import type { CodecTypes } from './codec-types';

const mongoTargetPack = mongoTargetDescriptorMeta;

export default mongoTargetPack as typeof mongoTargetPack & {
  readonly __codecTypes?: CodecTypes;
};
