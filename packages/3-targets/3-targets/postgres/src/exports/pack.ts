import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';

const postgresPack = postgresTargetDescriptorMeta;

export default postgresPack as typeof postgresTargetDescriptorMeta & {
  readonly __codecTypes?: CodecTypes;
};
