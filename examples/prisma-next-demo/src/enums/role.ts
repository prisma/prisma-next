/**
 * Centralized Role enum definition.
 *
 * This module provides:
 * - `ROLE_VALUES`: The ordered list of enum values (for contract definition)
 * - `Role`: TypeScript union type derived from the values
 * - `DEFAULT_ROLE`: The default role value for new users
 */
export const ROLE_VALUES = ['USER', 'ADMIN', 'MODERATOR'] as const;
export type Role = (typeof ROLE_VALUES)[number];
export const DEFAULT_ROLE: Role = 'USER';
