/**
 * Re-export SqlFamilyContext from sql-contract (shared plane) to maintain backward compatibility.
 * The type is defined in sql-contract to avoid cyclic dependencies with CLI.
 */
export type { SqlFamilyContext } from '@prisma-next/sql-contract/types';
