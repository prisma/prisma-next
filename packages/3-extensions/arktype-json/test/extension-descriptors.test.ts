import { describe, expect, it } from 'vitest';
import { ARKTYPE_JSON_CODEC_ID, arktypeJsonCodec } from '../src/core/arktype-json-codec';
import { arktypeJsonExtensionDescriptor } from '../src/exports/control';
import { arktypeJsonRuntimeDescriptor } from '../src/exports/runtime';

describe('arktypeJsonRuntimeDescriptor', () => {
  // The runtime descriptor is the SQL runtime's entry point for
  // arktype-json. It registers `arktypeJsonCodec` through the
  // `parameterizedCodecs:` slot and ships an empty legacy `codecs:`
  // registry — Phase B of codec-registry-unification: arktype-json's
  // codec metadata flows through the unified descriptor map only.
  it('declares family, target, and version aligned with pack-meta', () => {
    expect(arktypeJsonRuntimeDescriptor.familyId).toBe('sql');
    expect(arktypeJsonRuntimeDescriptor.targetId).toBe('postgres');
    expect(arktypeJsonRuntimeDescriptor.kind).toBe('extension');
    expect(arktypeJsonRuntimeDescriptor.id).toBe('arktype-json');
  });

  it('exposes the parameterized codec descriptor through parameterizedCodecs()', () => {
    expect(arktypeJsonRuntimeDescriptor.parameterizedCodecs()).toEqual([arktypeJsonCodec]);
  });

  it('returns an empty legacy codec registry from codecs()', () => {
    const registry = arktypeJsonRuntimeDescriptor.codecs();
    expect(registry.has(ARKTYPE_JSON_CODEC_ID)).toBe(false);
    expect([...registry]).toEqual([]);
  });

  it('create() returns an instance tagged with the family/target', () => {
    const instance = arktypeJsonRuntimeDescriptor.create();
    expect(instance.familyId).toBe('sql');
    expect(instance.targetId).toBe('postgres');
  });
});

describe('arktypeJsonExtensionDescriptor (control)', () => {
  // The control descriptor wires the migration-plane hooks into the SQL
  // family's control stack. arktype-json's `expandNativeType` is an
  // identity (`jsonb` is dimension-free) and there's no
  // `databaseDependencies` (`jsonb` is built into Postgres).
  it('declares family, target, and version aligned with pack-meta', () => {
    expect(arktypeJsonExtensionDescriptor.familyId).toBe('sql');
    expect(arktypeJsonExtensionDescriptor.targetId).toBe('postgres');
    expect(arktypeJsonExtensionDescriptor.kind).toBe('extension');
    expect(arktypeJsonExtensionDescriptor.id).toBe('arktype-json');
  });

  it('binds the codec id to the control-plane hooks', () => {
    const hooks = arktypeJsonExtensionDescriptor.types?.codecTypes?.controlPlaneHooks;
    expect(hooks).toBeDefined();
    expect(hooks?.[ARKTYPE_JSON_CODEC_ID]).toBeDefined();
  });

  it('expandNativeType is an identity (jsonb stays jsonb regardless of typeParams)', () => {
    const hooks = arktypeJsonExtensionDescriptor.types?.codecTypes?.controlPlaneHooks;
    const codecHooks = hooks?.[ARKTYPE_JSON_CODEC_ID] as
      | { expandNativeType?: (input: { nativeType: string }) => string }
      | undefined;
    expect(codecHooks?.expandNativeType).toBeDefined();
    expect(
      codecHooks?.expandNativeType?.({
        nativeType: 'jsonb',
      }),
    ).toBe('jsonb');
  });

  it('create() returns an instance tagged with the family/target', () => {
    const instance = arktypeJsonExtensionDescriptor.create();
    expect(instance.familyId).toBe('sql');
    expect(instance.targetId).toBe('postgres');
  });
});
