import { describe, expect, it } from 'vitest';
import { freezeNode, IRNodeBase, materializeAndFreezeEntries } from '../src/exports/ir';

class StubNode extends IRNodeBase {
  override readonly kind = 'stub' as const;
  readonly value: string;
  constructor(raw: unknown) {
    super();
    this.value =
      typeof raw === 'object' && raw !== null
        ? String((raw as { value?: unknown }).value ?? '')
        : '';
    freezeNode(this);
  }
}

const STUB_REGISTRY: ReadonlyMap<string, (raw: unknown) => StubNode> = new Map([
  ['things', (raw: unknown) => new StubNode(raw)],
]);

describe('materializeAndFreezeEntries', () => {
  it('returns empty object when input is empty', () => {
    const result = materializeAndFreezeEntries({}, STUB_REGISTRY);
    expect(result).toEqual({});
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('empty registry passthrough: passes input slots through unchanged when no factory registered', () => {
    const rawEntry = { kind: 'unknown', x: 1 };
    const result = materializeAndFreezeEntries({ things: { a: rawEntry } }, new Map());
    expect(result['things']?.['a']).toBe(rawEntry);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result['things'])).toBe(true);
  });

  it('instance-passthrough idempotence: already-IRNode instances pass through without re-construction', () => {
    const existing = new StubNode({ value: 'pre-built' });
    const result = materializeAndFreezeEntries({ things: { a: existing } }, STUB_REGISTRY);
    expect(result['things']?.['a']).toBe(existing);
  });

  it('raw-input materialization: plain objects are passed through the factory', () => {
    const result = materializeAndFreezeEntries(
      { things: { x: { value: 'hello' } } },
      STUB_REGISTRY,
    );
    const entry = result['things']?.['x'];
    expect(entry).toBeInstanceOf(StubNode);
    expect((entry as StubNode).value).toBe('hello');
  });

  it('freeze on inner and outer: both the per-slot record and the outer object are frozen', () => {
    const result = materializeAndFreezeEntries(
      { things: { a: { value: 'one' }, b: { value: 'two' } } },
      STUB_REGISTRY,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result['things'])).toBe(true);
  });

  it('handles multiple slots, each with its own registry entry', () => {
    const widgetRegistry: ReadonlyMap<string, (raw: unknown) => StubNode> = new Map([
      ['things', (raw: unknown) => new StubNode(raw)],
      ['gadgets', (raw: unknown) => new StubNode(raw)],
    ]);
    const result = materializeAndFreezeEntries(
      {
        things: { a: { value: 'thing-a' } },
        gadgets: { x: { value: 'gadget-x' } },
      },
      widgetRegistry,
    );
    expect(result['things']?.['a']).toBeInstanceOf(StubNode);
    expect(result['gadgets']?.['x']).toBeInstanceOf(StubNode);
    expect(Object.isFrozen(result['things'])).toBe(true);
    expect(Object.isFrozen(result['gadgets'])).toBe(true);
  });

  it('skips registry slots absent from input', () => {
    const result = materializeAndFreezeEntries(
      { things: { a: { value: 'a' } } },
      new Map([
        ['things', (raw: unknown) => new StubNode(raw)],
        ['absent-slot', (raw: unknown) => new StubNode(raw)],
      ]),
    );
    expect(Object.keys(result)).toEqual(['things']);
  });
});
