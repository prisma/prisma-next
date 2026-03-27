import { ParamRef } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { ParamCollector } from '../../src/runtime/param-collector';

describe('ParamCollector', () => {
  it('tracks values and returns 1-based ParamRef', () => {
    const pc = new ParamCollector();
    const ref1 = pc.add(42);
    const ref2 = pc.add('hello');

    expect(ref1).toBeInstanceOf(ParamRef);
    expect(ref1.index).toBe(1);
    expect(ref2.index).toBe(2);
    expect(pc.getValues()).toEqual([42, 'hello']);
    expect(pc.size).toBe(2);
  });
});
