import type { CodecTypes } from '@prisma-next/adapter-sqlite/codec-types';
import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { sqliteTargetDescriptorMeta } from '../core/descriptor-meta';

const sqlitePack = sqliteTargetDescriptorMeta;

export default sqlitePack as TargetPackRef<'sql', 'sqlite'> & {
  readonly __codecTypes?: CodecTypes;
};
