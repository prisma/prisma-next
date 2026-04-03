import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';

const postgresPack = postgresTargetDescriptorMeta;

export default postgresPack as typeof postgresTargetDescriptorMeta &
  TargetPackRef<'sql', 'postgres'> & {
    readonly __codecTypes?: CodecTypes;
  };
