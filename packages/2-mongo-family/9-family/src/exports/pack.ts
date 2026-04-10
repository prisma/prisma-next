import type { FamilyPackRef } from '@prisma-next/framework-components/components';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const;

export default mongoFamilyPack as typeof mongoFamilyPack & FamilyPackRef<'mongo'>;
