import type {
  ControlFamilyDescriptor,
  ControlStack,
} from '@prisma-next/framework-components/control';
import type { EmissionSpi } from '@prisma-next/framework-components/emission';
import { sqlEmission } from '@prisma-next/sql-contract-emitter';
import { sqlFamilyAuthoringFieldPresets } from './authoring-field-presets';
import { sqlFamilyAuthoringTypes } from './authoring-type-constructors';
import { createSqlFamilyInstance, type SqlControlFamilyInstance } from './control-instance';

export class SqlFamilyDescriptor
  implements ControlFamilyDescriptor<'sql', SqlControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'sql';
  readonly familyId = 'sql' as const;
  readonly version = '0.0.1';
  readonly emission: EmissionSpi = sqlEmission;
  readonly authoring = {
    field: sqlFamilyAuthoringFieldPresets,
    type: sqlFamilyAuthoringTypes,
  } as const;
  /**
   * Descriptor-meta type slots — read by the contract emitter's
   * alias-aggregation step (`extractQueryOperationTypeImports` in
   * `framework-components/control/control-stack.ts`) to lift the family's
   * `QueryOperationTypes<CT>` into the generated `Contract['queryOperationTypes']`
   * alias intersection. Mirrors the pattern at
   * `packages/3-extensions/pgvector/src/core/descriptor-meta.ts:97-103`.
   */
  readonly types = {
    queryOperationTypes: {
      import: {
        package: '@prisma-next/family-sql/operation-types',
        named: 'QueryOperationTypes',
        alias: 'SqlFamilyQueryOperationTypes',
      },
    },
  } as const;

  create<TTargetId extends string>(
    stack: ControlStack<'sql', TTargetId>,
  ): SqlControlFamilyInstance {
    return createSqlFamilyInstance(stack);
  }
}
