import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { sqliteTargetDescriptorMeta } from '../core/descriptor-meta';

const sqlitePack: TargetPackRef<'sql', 'sqlite'> = sqliteTargetDescriptorMeta;

export default sqlitePack;
