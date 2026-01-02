import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';

const postgresPack: TargetPackRef<'sql', 'postgres'> = postgresTargetDescriptorMeta;

export default postgresPack;
