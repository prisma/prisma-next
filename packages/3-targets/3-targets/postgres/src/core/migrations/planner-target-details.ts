import { ifDefined } from '@prisma-next/utils/defined';

export type OperationClass =
  | 'dependency'
  | 'type'
  | 'table'
  | 'column'
  | 'primaryKey'
  | 'unique'
  | 'index'
  | 'foreignKey';

export interface PostgresPlanTargetDetails {
  readonly schema: string;
  readonly objectType: OperationClass;
  readonly name: string;
  readonly table?: string;
}

export interface PlanningMode {
  readonly includeExtraObjects: boolean;
  readonly allowWidening: boolean;
  readonly allowDestructive: boolean;
}

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
