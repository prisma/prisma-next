/**
 * Control-plane hooks for the arktype-json codec.
 *
 * Unlike pgvector (which renders `vector(N)` from `typeParams.length`),
 * arktype-json's storage backing is bare `jsonb` regardless of the schema —
 * the typeParams (`expression`, `jsonIr`) carry the schema for runtime
 * validation, not a DDL-shape parameter. The hook is therefore an identity
 * `expandNativeType`: emit `jsonb` always.
 *
 * The hook is registered through the control-extension descriptor's
 * `controlPlaneHooks` slot so the migration planner doesn't surface a
 * "no expandNativeType hook is registered for codecId 'arktype/json@1'"
 * error when the column carries typeParams.
 */

import type { CodecControlHooks } from '@prisma-next/family-sql/control';

export const arktypeJsonControlPlaneHooks: CodecControlHooks = {
  expandNativeType: ({ nativeType }) => nativeType,
};
