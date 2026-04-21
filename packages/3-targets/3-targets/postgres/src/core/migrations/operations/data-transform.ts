import type {
  DataTransformOperation,
  SerializedQueryPlan,
} from '@prisma-next/framework-components/control';

/**
 * Creates a serialized data transform operation from pre-serialized query
 * plans. The descriptor resolver in `operation-resolver.ts` handles closure
 * invocation and `lowerSqlPlan` before calling this factory.
 */
export function createDataTransform(options: {
  readonly name: string;
  readonly source: string;
  readonly check: SerializedQueryPlan | boolean | null;
  readonly run: readonly SerializedQueryPlan[];
}): DataTransformOperation {
  return {
    id: `data_migration.${options.name}`,
    label: `Data transform: ${options.name}`,
    operationClass: 'data',
    name: options.name,
    source: options.source,
    check: options.check,
    run: [...options.run],
  };
}
