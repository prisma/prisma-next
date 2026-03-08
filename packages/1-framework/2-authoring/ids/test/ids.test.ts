import { describe, expect, it } from 'vitest';
import { cuid2, ksuid, nanoid, ulid, uuidv4, uuidv7 } from '../src/index';
import { generateId } from '../src/runtime';

describe('@prisma-next/ids', () => {
  it('builds a generated column spec for uuidv4', () => {
    const spec = uuidv4();
    expect(spec).toEqual({
      type: { codecId: 'sql/char@1', nativeType: 'character' },
      nullable: false,
      typeParams: { length: 36 },
      generated: { kind: 'generator', id: 'uuidv4' },
    });
  });

  it.each([
    ['ulid', ulid],
    ['nanoid', nanoid],
    ['uuidv7', uuidv7],
    ['uuidv4', uuidv4],
    ['cuid2', cuid2],
    ['ksuid', ksuid],
  ] as const)('builds generated spec for %s', (id, buildSpec) => {
    const spec = buildSpec();
    expect(spec.generated.id).toBe(id);
  });

  it.each([
    'ulid',
    'nanoid',
    'uuidv7',
    'uuidv4',
    'cuid2',
    'ksuid',
  ] as const)('generates values for %s', (id) => {
    const value = generateId({ id });
    expect(typeof value).toBe('string');
    expect(value).not.toBe('');
  });

  it('stores generator options in execution defaults', () => {
    const spec = nanoid({ size: 12 });
    expect(spec.typeParams).toEqual({ length: 12 });
    expect(spec.generated.params).toEqual({ size: 12 });
  });

  it('applies generator params at runtime', () => {
    const value = generateId({ id: 'nanoid', params: { size: 12 } });
    expect(value).toHaveLength(12);
  });

  it('throws for unknown generator id', () => {
    expect(() => generateId({ id: 'nonexistent' })).toThrow('Unknown built-in ID generator');
  });

  it('rejects nanoid with invalid size', () => {
    expect(() => nanoid({ size: 1 })).toThrow('nanoid size must be an integer between 2 and 255');
    expect(() => nanoid({ size: 256 })).toThrow('nanoid size must be an integer between 2 and 255');
    expect(() => nanoid({ size: 3.5 } as never)).toThrow(
      'nanoid size must be an integer between 2 and 255',
    );
  });

  it('accepts nanoid with valid size', () => {
    expect(nanoid({ size: 2 }).typeParams).toEqual({ length: 2 });
    expect(nanoid({ size: 255 }).typeParams).toEqual({ length: 255 });
  });
});
