import type { TargetPackRef } from '@prisma-next/sql-contract/pack-types';

const postgresPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {},
};

export default postgresPack;
