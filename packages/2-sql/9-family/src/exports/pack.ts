import type { FamilyPackRef } from '@prisma-next/framework-components/components';
import { sqlFamilyAuthoringFieldPresets } from '../core/authoring-field-presets';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: sqlFamilyAuthoringFieldPresets,
  },
} as const;

export default sqlFamilyPack as typeof sqlFamilyPack & FamilyPackRef<'sql'>;
