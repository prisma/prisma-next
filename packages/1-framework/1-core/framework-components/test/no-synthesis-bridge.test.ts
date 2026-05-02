import { describe, expect, it } from 'vitest';
import * as codecExports from '../src/exports/codec';
import * as codecShared from '../src/shared/codec-types';

// Constructive check that the legacy synthesis bridge is unreachable
// from production code paths (TML-2357 plan T2.10). The bridge — once
// `synthesizeNonParameterizedDescriptor` — converted legacy `Codec`
// instances into `CodecDescriptor`s while contributors migrated; under
// the unified registration shape every codec ships a native
// `CodecDescriptor` directly, with no synthesis layer in between.
describe('no synthesis bridge in production code paths', () => {
  it('framework-components/codec does not export synthesizeNonParameterizedDescriptor', () => {
    expect('synthesizeNonParameterizedDescriptor' in codecExports).toBe(false);
  });

  it('framework-components/shared/codec-types does not export synthesizeNonParameterizedDescriptor', () => {
    expect('synthesizeNonParameterizedDescriptor' in codecShared).toBe(false);
  });
});
