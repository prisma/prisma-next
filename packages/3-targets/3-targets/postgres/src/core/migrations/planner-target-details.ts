import { ifDefined } from '@prisma-next/utils/defined';
import type { OperationClass, PostgresPlanTargetDetails } from './planner';

export function buildTargetDetails(
  objectType: OperationClass,
  name: string,
  schema: string,
  table?: string,
): PostgresPlanTargetDetails {
  return {
    schema,
    objectType,
    name,
    ...ifDefined('table', table),
  };
}
