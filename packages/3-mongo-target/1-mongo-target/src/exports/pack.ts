import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { mongoTargetDescriptorMeta } from '../core/descriptor-meta';
import type { CodecTypes } from './codec-types';

const mongoTargetPack = mongoTargetDescriptorMeta;

export default mongoTargetPack as typeof mongoTargetPack &
  TargetPackRef<'mongo', 'mongo'> & {
    readonly __codecTypes?: CodecTypes;
  };
