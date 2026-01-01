import type { TargetPackRef } from '@prisma-next/contract/pack-ref-types';
import { manifest } from '../core/manifest';

const postgresPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: manifest.id,
  familyId: 'sql',
  targetId: 'postgres',
  version: manifest.version,
  targets: manifest.targets,
  capabilities: manifest.capabilities,
  types: manifest.types,
  operations: manifest.operations,
};

export default postgresPack;
