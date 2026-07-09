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

  it('throws when self has neither codecId nor traits', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('bad', {
        // @ts-expect-error — SelfSpec requires codecId or traits
        self: {},
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self has neither codecId nor traits');
  });

  it('throws when self has an empty traits array', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('bad', {
        self: { traits: [] },
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self has neither codecId nor traits');
  });

  it('throws when self has both codecId and traits', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('bad', {
        // @ts-expect-error — SelfSpec disallows both codecId and traits
        self: { codecId: 'pg/text@1', traits: ['textual'] },
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self has both codecId and traits');
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

  it('accepts a list (many) self', () => {
    const registry = createOperationRegistry();

    expect(() => registry.register('has', descriptor({ self: { many: true } }))).not.toThrow();
  });

  it('accepts a list (many) self with elementTraits', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('has', descriptor({ self: { many: true, elementTraits: ['equality'] } })),
    ).not.toThrow();
  });

  it('throws when self combines many with codecId', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register('bad', {
        // @ts-expect-error — SelfSpec disallows many alongside codecId
        self: { many: true, codecId: 'pg/text@1' },
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self has both codecId and traits');
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
