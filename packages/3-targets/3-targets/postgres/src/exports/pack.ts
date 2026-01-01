import type { TargetPackRef } from '@prisma-next/sql-contract/pack-types';

const postgresPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '15.0.0',
  targets: {
    postgres: { minVersion: '12' },
  },
  capabilities: {},
};

export default postgresPack;
