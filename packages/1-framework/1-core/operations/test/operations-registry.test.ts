import { describe, expect, it } from 'vitest';
import {
  createOperationRegistry,
  type OperationDescriptor,
  type OperationEntry,
} from '../src/index';

describe('OperationRegistry', () => {
  const noopImpl = () => undefined;

  const descriptor = (overrides?: Partial<OperationEntry>): OperationDescriptor => ({
    self: { codecId: 'pg/vector@1' },
    impl: noopImpl,
    ...overrides,
  });

  it('creates empty registry', () => {
    const registry = createOperationRegistry();
    expect(registry.entries()).toEqual({});
  });

  it('registers and retrieves an operation', () => {
    const registry = createOperationRegistry();
    registry.register('cosineDistance', descriptor());

    const entries = registry.entries();
    expect(entries['cosineDistance']).toEqual({
      self: { codecId: 'pg/vector@1' },
      impl: noopImpl,
    });
  });

  it('registers multiple operations', () => {
    const registry = createOperationRegistry();
    registry.register('cosineDistance', descriptor());
    registry.register('l2Distance', descriptor());

    const entries = registry.entries();
    expect(Object.keys(entries)).toEqual(['cosineDistance', 'l2Distance']);
  });

  it('throws on duplicate method name', () => {
    const registry = createOperationRegistry();
    registry.register('cosineDistance', descriptor());

    expect(() => registry.register('cosineDistance', descriptor())).toThrow(
      'Operation "cosineDistance" is already registered',
    );
  });

  it('throws when self has none of codecId, traits, or any', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('bad', {
        // @ts-expect-error — SelfSpec requires codecId, traits, or any
        self: {},
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self has none of codecId, traits, or any');
  });

  it('throws when self has an empty traits array', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('bad', {
        self: { traits: [] },
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self has none of codecId, traits, or any');
  });

  it('throws when self combines codecId and traits', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('bad', {
        // @ts-expect-error — SelfSpec disallows combining codecId and traits
        self: { codecId: 'pg/text@1', traits: ['textual'] },
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self combines codecId and traits');
  });

  it('accepts self with any: true', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register(
        'fine',
        descriptor({
          self: { any: true },
        }),
      ),
    ).not.toThrow();
  });

  it('throws when self combines any with codecId', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('bad', {
        // @ts-expect-error — SelfSpec disallows combining any with codecId
        self: { any: true, codecId: 'pg/text@1' },
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self combines any with codecId or traits');
  });

  it('throws when self combines any with traits', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('bad', {
        // @ts-expect-error — SelfSpec disallows combining any with traits
        self: { any: true, traits: ['textual'] },
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self combines any with codecId or traits');
  });

  it('accepts trait-only self', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register(
        'fine',
        descriptor({
          self: { traits: ['textual'] },
        }),
      ),
    ).not.toThrow();
  });

  it('accepts self-less operation', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('builtin', {
        impl: noopImpl,
      }),
    ).not.toThrow();
  });

  it('returns frozen entries', () => {
    const registry = createOperationRegistry();
    registry.register('cosineDistance', descriptor());

    const entries = registry.entries();
    expect(Object.isFrozen(entries)).toBe(true);
  });

  it('works with custom entry types', () => {
    interface CustomEntry extends OperationEntry {
      readonly extra: string;
    }

    const registry = createOperationRegistry<CustomEntry>();
    registry.register('custom', {
      self: { codecId: 'core/int4' },
      impl: noopImpl,
      extra: 'metadata',
    });

    const entry = registry.entries()['custom'];
    expect(entry?.extra).toBe('metadata');
  });
});
