import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract as coreValidateContract } from '@prisma-next/sql-contract/validate';

/**
 * Validates that a JSON import conforms to the SqlContract structure
 * and returns a fully typed SqlContract.
 *
 * Delegates to the core SQL `validateContract`, which in turn delegates to the
 * framework `validateContract` with a SQL-specific `StorageValidator`. The
 * framework handles persistence field stripping, structural validation, and
 * domain validation; the SQL layer adds storage-specific checks and bigint
 * default decoding.
 *
 * This function is specifically for validating JSON imports (e.g., from contract.json).
 * Contracts created via the builder API (defineContract) are already valid and should
 * not be passed to this function - use them directly without validation.
 *
 * The type parameter `TContract` must be a fully-typed contract type (e.g., from `contract.d.ts`),
 * NOT a generic `Contract<SqlStorage>`.
 *
 * **Correct:**
 * ```typescript
 * import type { Contract } from './contract.d';
 * const contract = validateContract<Contract>(contractJson);
 * ```
 *
 * **Incorrect:**
 * ```typescript
 * import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
 * const contract = validateContract<Contract<SqlStorage>>(contractJson);
 * // Types will be inferred as 'unknown' - this won't work!
 * ```
 *
 * @param value - The contract value to validate (must be from a JSON import, not a builder)
 * @returns A validated contract matching the TContract type
 * @throws Error if the contract structure or logic is invalid
 */
export function validateContract<TContract extends Contract<SqlStorage>>(
  value: unknown,
): TContract {
  return coreValidateContract<TContract>(value);
}
