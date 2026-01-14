import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';

/**
 * A userland default generator function.
 * Called at insert time to generate values for columns with userland defaults.
 */
export type UserlandGenerator = () => unknown;

/**
 * A named userland generator definition.
 */
export interface UserlandGeneratorDefinition {
  readonly name: string;
  readonly generator: UserlandGenerator;
}

/**
 * Registry mapping generator names to their functions.
 */
export type UserlandGeneratorRegistry = Map<string, UserlandGenerator>;

/**
 * Creates an empty userland generator registry.
 */
export function createUserlandGeneratorRegistry(): UserlandGeneratorRegistry {
  return new Map();
}

/**
 * Resolves userland defaults for columns not provided in data.
 * Returns a new data object with generated values filled in.
 *
 * This function examines the contract's storage definition to find columns
 * with userland defaults, then uses the registry to generate values for
 * any columns not already provided in the input data.
 *
 * @param data - The input data object (field/column values provided by user)
 * @param tableName - The name of the table being inserted into
 * @param contract - The SQL contract containing storage definitions
 * @param registry - The registry of userland generators
 * @returns A new data object with generated values for userland defaults
 */
export function resolveUserlandDefaults(
  data: Record<string, unknown>,
  tableName: string,
  contract: SqlContract<SqlStorage>,
  registry: UserlandGeneratorRegistry,
): Record<string, unknown> {
  const table = contract.storage.tables[tableName];
  if (!table) {
    return data;
  }

  const result = { ...data };

  for (const [columnName, column] of Object.entries(table.columns)) {
    // Skip if value already provided
    if (Object.hasOwn(result, columnName)) {
      continue;
    }

    // Check for userland default
    if (column.default?.kind === 'userland') {
      const generator = registry.get(column.default.name);
      if (generator) {
        result[columnName] = generator();
      }
    }
  }

  return result;
}
