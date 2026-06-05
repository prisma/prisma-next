/**
 * Smoke test: /pack resolution + typecheck contract (D7).
 *
 * Proves three things independent of the example app:
 *
 * 1. `supabasePack` (the default export from the /pack subpath) is assignable
 *    to `ControlExtensionDescriptor<'sql', 'postgres'>` — the element type that
 *    `extensionPacks` in `PrismaNextConfig` accepts.
 *
 * 2. `supabasePackWith({ contractOverride })` returns the same type as
 *    `supabasePack` itself — so override-based usage is interchangeable.
 *
 * 3. Both values are accepted in the `extensionPacks` array position of a
 *    `PrismaNextConfig<'sql', 'postgres'>` without a type error — i.e. the
 *    `/pack` export satisfies the config contract.
 *
 * This file is intentionally type-level only (no runtime assertions). It
 * covers slice-DoD #1: "/pack resolves and typechecks when imported from an
 * app contract declaring `extensionPacks: [supabasePack]`."
 */

import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';
import { expectTypeOf, test } from 'vitest';
import supabasePack, { supabasePackWith } from '../src/exports/pack';

test('supabasePack is a ControlExtensionDescriptor<sql, postgres>', () => {
  expectTypeOf(supabasePack).toExtend<ControlExtensionDescriptor<'sql', 'postgres'>>();
});

test('supabasePack.kind is the literal "extension"', () => {
  expectTypeOf(supabasePack.kind).toEqualTypeOf<'extension'>();
});

test('supabasePack.familyId is the literal "sql"', () => {
  expectTypeOf(supabasePack.familyId).toEqualTypeOf<'sql'>();
});

test('supabasePack.targetId is the literal "postgres"', () => {
  expectTypeOf(supabasePack.targetId).toEqualTypeOf<'postgres'>();
});

test('supabasePackWith() returns the same type as supabasePack', () => {
  const fromWith = supabasePackWith();
  expectTypeOf(fromWith).toEqualTypeOf(supabasePack);
});

test('supabasePackWith({ contractOverride }) returns the same type as supabasePack', () => {
  const fromWith = supabasePackWith({ contractOverride: {} });
  expectTypeOf(fromWith).toEqualTypeOf(supabasePack);
});

test('supabasePack is usable as an extensionPacks element (ControlExtensionDescriptor array member)', () => {
  const packs: readonly ControlExtensionDescriptor<'sql', 'postgres'>[] = [supabasePack];
  expectTypeOf(packs).toExtend<readonly ControlExtensionDescriptor<'sql', 'postgres'>[]>();
});
