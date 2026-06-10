import type { FamilyPackRef } from '@prisma-next/framework-components/components';
import {
  sqlFamilyAuthoringEntityTypes,
  sqlFamilyPslBlockDescriptors,
} from '../core/authoring-entity-types';
import { sqlFamilyAuthoringFieldPresets } from '../core/authoring-field-presets';
import { sqlFamilyAuthoringTypes } from '../core/authoring-type-constructors';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: sqlFamilyAuthoringFieldPresets,
    type: sqlFamilyAuthoringTypes,
    entityTypes: sqlFamilyAuthoringEntityTypes,
    pslBlockDescriptors: sqlFamilyPslBlockDescriptors,
  },
} as const satisfies FamilyPackRef<'sql'>;

export default sqlFamilyPack;
