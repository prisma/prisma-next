import type { CodecDescriptor } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import type { AnyCodecDescriptor } from '../src/ast/codec-types';
import { buildCodecDescriptorRegistry } from '../src/codec-descriptor-registry';

const stub = (codecId: string, targetTypes: readonly string[]): AnyCodecDescriptor =>
  ({
    codecId,
    traits: [],
    targetTypes,
    isParameterized: false,
    paramsSchema: undefined,
    factory: () => () => ({ id: codecId }) as never,
  }) as unknown as AnyCodecDescriptor;

describe('buildCodecDescriptorRegistry', () => {
  it('descriptorFor returns the registered descriptor by codec id', () => {
    const a = stub('lib/a@1', ['ta']);
    const b = stub('lib/b@1', ['tb']);
    const registry = buildCodecDescriptorRegistry([a, b]);

    expect(registry.descriptorFor('lib/a@1')).toBe(a as unknown as CodecDescriptor<unknown>);
    expect(registry.descriptorFor('lib/b@1')).toBe(b as unknown as CodecDescriptor<unknown>);
  });

  it('descriptorFor returns undefined for an unknown codec id', () => {
    const registry = buildCodecDescriptorRegistry([stub('lib/a@1', ['ta'])]);
    expect(registry.descriptorFor('lib/missing@1')).toBeUndefined();
  });

  it('values() yields all registered descriptors in registration order', () => {
    const a = stub('lib/a@1', ['ta']);
    const b = stub('lib/b@1', ['tb']);
    const c = stub('lib/c@1', ['tc']);
    const registry = buildCodecDescriptorRegistry([a, b, c]);

    expect([...registry.values()]).toEqual([a, b, c]);
  });

  it('byTargetType groups descriptors that advertise the same target type', () => {
    const a = stub('lib/a@1', ['shared']);
    const b = stub('lib/b@1', ['shared', 'extra']);
    const registry = buildCodecDescriptorRegistry([a, b]);

    expect(registry.byTargetType('shared')).toEqual([a, b]);
    expect(registry.byTargetType('extra')).toEqual([b]);
  });

  it('byTargetType returns an empty frozen array for an unknown target type', () => {
    const registry = buildCodecDescriptorRegistry([stub('lib/a@1', ['ta'])]);
    const result = registry.byTargetType('unknown');
    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('throws when a codec id is registered twice', () => {
    const a = stub('lib/dup@1', ['ta']);
    const a2 = stub('lib/dup@1', ['tb']);
    expect(() => buildCodecDescriptorRegistry([a, a2])).toThrowError(
      /Duplicate codec descriptor id: 'lib\/dup@1'/,
    );
  });
});
