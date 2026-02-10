import { describe, expect, it } from 'vitest';
import { cuid2, ksuid, nanoid, ulid, uuidv4, uuidv7 } from '../src/index';
import { generateId } from '../src/runtime';

describe('@prisma-next/ids', () => {
  it('builds a generated column spec for uuidv4', () => {
    const spec = uuidv4();
    expect(spec).toEqual({
      type: { codecId: 'pg/text@1', nativeType: 'text' },
      nullable: false,
      generated: { kind: 'generator', id: 'uuidv4' },
    });
  });

  it('generates values for uuidv4', () => {
    const value = generateId({ id: 'uuidv4' });
    expect(typeof value).toBe('string');
    expect(value).not.toBe('');
  });

  it('builds generated specs for all supported ids', () => {
    const specs = {
      ulid: ulid(),
      nanoid: nanoid(),
      uuidv7: uuidv7(),
      uuidv4: uuidv4(),
      cuid2: cuid2(),
      ksuid: ksuid(),
    };

    for (const [id, spec] of Object.entries(specs)) {
      expect(spec.generated.id).toBe(id);
    }
  });

  it('stores generator options in execution defaults', () => {
    const spec = nanoid({ size: 12 });
    expect(spec.generated.params).toEqual({ size: 12 });
  });
});
