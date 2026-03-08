import type { SqlMappings } from '../src/types';

export const RUNTIME_MAPPING_KEYS: (keyof SqlMappings)[] = [
  'modelToTable',
  'tableToModel',
  'fieldToColumn',
  'columnToField',
];
