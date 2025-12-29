/**
 * Re-export Result types and functions from @prisma-next/utils.
 *
 * This module is kept for backwards compatibility. New code should import
 * directly from '@prisma-next/utils/result'.
 */
export type { NotOk, Ok, Result } from '@prisma-next/utils/result';
export { notOk, ok, okVoid } from '@prisma-next/utils/result';
