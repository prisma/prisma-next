import { describe, expect, it } from 'vitest';
import {
  createOperationRegistry,
  type OperationDescriptor,
  type OperationEntry,
} from '../src/index';

describe('OperationRegistry', () => {
  const noopImpl = () => undefined;

  const descriptor = (
    method: string,
    overrides?: Partial<OperationEntry>,
  ): OperationDescriptor => ({
    method,
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
    registry.register(descriptor('cosineDistance'));

    const entries = registry.entries();
    expect(entries['cosineDistance']).toEqual({
      self: { codecId: 'pg/vector@1' },
      impl: noopImpl,
    });
  });

  it('registers multiple operations', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('cosineDistance'));
    registry.register(descriptor('l2Distance'));

    const entries = registry.entries();
    expect(Object.keys(entries)).toEqual(['cosineDistance', 'l2Distance']);
  });

  it('throws on duplicate (method, self) pair', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    expect(() => registry.register(descriptor('cosineDistance'))).toThrow(
      'Operation "cosineDistance" is already registered with the same self discriminator (c:pg/vector@1)',
    );
  });

  it('allows same-method ops with different self discriminators (codecId vs codecId)', () => {
    // Coexistence pattern needed by extension packs that target a
    // specific codec while a target adapter (e.g. postgres) registers
    // the same method name for a different codec. The model accessor's
    // per-codec dispatch (model-accessor.ts) consumes `all()` so each
    // op reaches only the columns it targets.
    const registry = createOperationRegistry();
    registry.register(descriptor('eq', { self: { codecId: 'pg/text@1' } }));

    expect(() =>
      registry.register(descriptor('eq', { self: { codecId: 'cipherstash/string@1' } })),
    ).not.toThrow();

    expect(registry.all()).toHaveLength(2);
  });

  it('allows same-method ops with different self discriminators (codecId vs traits)', () => {
    // The cipherstash `ilike` (codec-id-targeted) coexisting with the
    // postgres `ilike` (trait-gated) is the load-bearing case from
    // M3 R1 — exact configuration this test pins.
    const registry = createOperationRegistry();
    registry.register(descriptor('ilike', { self: { traits: ['textual'] } }));

    expect(() =>
      registry.register(descriptor('ilike', { self: { codecId: 'cipherstash/string@1' } })),
    ).not.toThrow();

    const all = registry.all();
    expect(all.map((d) => d.method)).toEqual(['ilike', 'ilike']);
  });

  it('throws on duplicate (method, self.codecId) — same codec, same method', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('eq', { self: { codecId: 'pg/text@1' } }));

    expect(() => registry.register(descriptor('eq', { self: { codecId: 'pg/text@1' } }))).toThrow(
      /already registered with the same self discriminator \(c:pg\/text@1\)/,
    );
  });

  it('treats trait sets as sorted for fingerprinting', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('cmp', { self: { traits: ['equality', 'order'] } }));

    expect(() =>
      registry.register(descriptor('cmp', { self: { traits: ['order', 'equality'] } })),
    ).toThrow(/already registered with the same self discriminator \(t:equality,order\)/);
  });

  it('all() returns descriptors in registration order, frozen', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('first'));
    registry.register(descriptor('second', { self: { codecId: 'pg/text@1' } }));

    const all = registry.all();
    expect(all.map((d) => d.method)).toEqual(['first', 'second']);
    expect(Object.isFrozen(all)).toBe(true);
  });

  it('entries() returns last-write-wins method view across multi-self ops', () => {
    // Documented contract: `entries()` is the global `fns` namespace
    // view (one per method). When multiple ops share a method, the
    // last registered wins — sql-builder's global `fns` should not be
    // surprised by codec-id-targeted ops.
    const registry = createOperationRegistry();
    registry.register(descriptor('ilike', { self: { traits: ['textual'] } }));
    registry.register(descriptor('ilike', { self: { codecId: 'cipherstash/string@1' } }));

    const entries = registry.entries();
    expect(Object.keys(entries)).toEqual(['ilike']);
    expect(entries['ilike']?.self).toEqual({ codecId: 'cipherstash/string@1' });
  });

  it('throws when self has neither codecId nor traits', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register({
        method: 'bad',
        // @ts-expect-error — SelfSpec requires codecId or traits
        self: {},
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self has neither codecId nor traits');
  });

  it('throws when self has an empty traits array', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register({
        method: 'bad',
        self: { traits: [] },
        impl: noopImpl,
      }),
    ).toThrow('Operation "bad" self has neither codecId nor traits');
  });

  it('throws when self has both codecId and traits', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register({
        method: 'bad',
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
        descriptor('fine', {
          self: { traits: ['textual'] },
        }),
      ),
    ).not.toThrow();
  });

  it('accepts self-less operation', () => {
    const registry = createOperationRegistry();

    expect(() =>
      registry.register({
        method: 'builtin',
        impl: noopImpl,
      }),
    ).not.toThrow();
  });

  it('strips method from stored entry', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    const entry = registry.entries()['cosineDistance'];
    expect(entry).not.toHaveProperty('method');
  });

  it('returns frozen entries', () => {
    const registry = createOperationRegistry();
    registry.register(descriptor('cosineDistance'));

    const entries = registry.entries();
    expect(Object.isFrozen(entries)).toBe(true);
  });

  it('works with custom entry types', () => {
    interface CustomEntry extends OperationEntry {
      readonly extra: string;
    }

    const registry = createOperationRegistry<CustomEntry>();
    registry.register({
      method: 'custom',
      self: { codecId: 'core/int4' },
      impl: noopImpl,
      extra: 'metadata',
    });

    const entry = registry.entries()['custom'];
    expect(entry?.extra).toBe('metadata');
  });
});
