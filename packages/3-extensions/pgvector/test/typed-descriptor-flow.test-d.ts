/**
 * Constructive type tests for the pgvector per-extension descriptor
 * record layer (TML-2357). Mirrors the per-
 * target tests in postgres / sqlite.
 */

import type { AnyCodecDescriptor, CodecTrait } from '@prisma-next/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import {
  codecDescriptors,
  type PgVectorDescriptor,
  pgVectorDescriptor,
} from '../src/core/codecs-class';
import type { CodecTypes } from '../src/exports/codec-types';

// ---------------------------------------------------------------------------
// Heterogeneous descriptor storage narrows to AnyCodecDescriptor.
// ---------------------------------------------------------------------------

test('codecDescriptors narrows to readonly AnyCodecDescriptor[]', () => {
  expectTypeOf(codecDescriptors).toEqualTypeOf<readonly AnyCodecDescriptor[]>();
});

test('list entries extend AnyCodecDescriptor', () => {
  expectTypeOf<(typeof codecDescriptors)[number]>().toExtend<AnyCodecDescriptor>();
});

// ---------------------------------------------------------------------------
// Trait literals preserved on the pgvector descriptor (M0 R5 fix).
// ---------------------------------------------------------------------------

test('pgVectorDescriptor.traits is the readonly literal tuple', () => {
  type Traits = PgVectorDescriptor['traits'];
  expectTypeOf<Traits>().toEqualTypeOf<readonly ['equality']>();
  expectTypeOf<Traits[number]>().toExtend<CodecTrait>();
});

test('pgVectorDescriptor.codecId is the literal `pg/vector@1`', () => {
  expectTypeOf(pgVectorDescriptor.codecId).toEqualTypeOf<'pg/vector@1'>();
});

// ---------------------------------------------------------------------------
// CodecTypes projection contains the expected codec-id key.
// ---------------------------------------------------------------------------

test('CodecTypes is keyed by codec id and exposes input/output/traits', () => {
  expectTypeOf<CodecTypes['pg/vector@1']>().toExtend<{
    readonly input: number[];
    readonly output: number[];
    readonly traits: 'equality';
  }>();
});

// ---------------------------------------------------------------------------
// Negative tests.
// ---------------------------------------------------------------------------

test('widened trait shape on pgVector fails the equality check', () => {
  type Traits = PgVectorDescriptor['traits'];
  // @ts-expect-error -- traits literal tuple is preserved, not widened to CodecTrait[]
  expectTypeOf<Traits>().toEqualTypeOf<readonly CodecTrait[]>();
});

test('non-existent codec id is absent from CodecTypes', () => {
  // @ts-expect-error -- `pg/nonexistent@1` is not a registered codec id
  type _Missing = CodecTypes['pg/nonexistent@1'];
});
