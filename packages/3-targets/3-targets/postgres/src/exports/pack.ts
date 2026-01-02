import type { TargetPackRef } from '@prisma-next/sql-contract/pack-types';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';

const postgresPack: TargetPackRef<'sql', 'postgres'> = postgresTargetDescriptorMeta;

export default postgresPack;
