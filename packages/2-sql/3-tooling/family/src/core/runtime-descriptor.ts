import type { RuntimeFamilyDescriptor } from '@prisma-next/core-execution-plane/types';
import { createSqlRuntimeFamilyInstance, type SqlRuntimeFamilyInstance } from './runtime-instance';

export const sqlRuntimeFamilyDescriptor: RuntimeFamilyDescriptor<'sql', SqlRuntimeFamilyInstance> =
  {
    kind: 'family',
    id: 'sql',
    familyId: 'sql',
    version: '0.0.1',
    create() {
      return createSqlRuntimeFamilyInstance();
    },
  };

Object.freeze(sqlRuntimeFamilyDescriptor);
