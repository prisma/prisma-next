import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';

const postgresPack = postgresTargetDescriptorMeta;

export default postgresPack as TargetPackRef<'sql', 'postgres'> & {
  readonly __codecTypes?: CodecTypes;
};
