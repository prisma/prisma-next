import { describe, expect, it } from 'vitest';
import { createReplEvaluator } from '../../src/repl/evaluator';
import { materializeResult } from '../../src/repl/materialize';

describe('createReplEvaluator', () => {
  it('evaluates expressions', async () => {
    const evaluator = createReplEvaluator({});
    const result = await evaluator.evaluate('1 + 2');
    expect(result).toEqual({ ok: true, value: 3 });
  });

  it('evaluates object literals as expressions', async () => {
    const evaluator = createReplEvaluator({});
    const result = await evaluator.evaluate('{ a: 1 }');
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('persists const declarations across evaluations', async () => {
    const evaluator = createReplEvaluator({});
    await evaluator.evaluate('const x = 41');
    const result = await evaluator.evaluate('x + 1');
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('persists let and var declarations', async () => {
    const evaluator = createReplEvaluator({});
    await evaluator.evaluate('let a = 1; var b = 2;');
    expect(await evaluator.evaluate('a + b')).toEqual({ ok: true, value: 3 });
  });

  it('exposes injected globals', async () => {
    const evaluator = createReplEvaluator({ base: 40 });
    expect(await evaluator.evaluate('base + 2')).toEqual({ ok: true, value: 42 });
  });

  it('strips TypeScript type annotations', async () => {
    const evaluator = createReplEvaluator({});
    const result = await evaluator.evaluate('const n: number = 7; n');
    expect(result).toEqual({ ok: true, value: 7 });
  });

  it('awaits top-level await expressions', async () => {
    const evaluator = createReplEvaluator({});
    const result = await evaluator.evaluate('await Promise.resolve(5)');
    expect(result).toEqual({ ok: true, value: 5 });
  });

  it('persists const bindings assigned from await', async () => {
    const evaluator = createReplEvaluator({});
    await evaluator.evaluate('const v = await Promise.resolve(9)');
    expect(await evaluator.evaluate('v')).toEqual({ ok: true, value: 9 });
  });

  it('returns errors instead of throwing', async () => {
    const evaluator = createReplEvaluator({});
    const result = await evaluator.evaluate('nope.nope');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Engine-thrown errors originate in the vm realm, so assert on shape
      // (name/message) rather than host-realm instanceof.
      expect(String(result.error)).toContain('nope is not defined');
    }
  });

  it('reports syntax errors', async () => {
    const evaluator = createReplEvaluator({});
    const result = await evaluator.evaluate('const = 1');
    expect(result.ok).toBe(false);
  });

  it('supports multi-statement input returning the last expression value', async () => {
    const evaluator = createReplEvaluator({});
    const result = await evaluator.evaluate('const y = 2; y * 3');
    expect(result).toEqual({ ok: true, value: 6 });
  });

  it('lists global names including injected globals and user bindings', async () => {
    const evaluator = createReplEvaluator({ db: {} });
    await evaluator.evaluate('const mine = 1');
    const names = evaluator.globalNames();
    expect(names).toContain('db');
    expect(names).toContain('mine');
  });

  it('evaluates multi-statement input starting with an awaited declaration', async () => {
    const evaluator = createReplEvaluator({});
    const result = await evaluator.evaluate(
      'const rows = await Promise.resolve([1, 2]); rows.length',
    );
    expect(result.ok).toBe(true);
    expect(await evaluator.evaluate('rows.length')).toEqual({ ok: true, value: 2 });
  });

  it('persists async function declarations across evaluations', async () => {
    const evaluator = createReplEvaluator({});
    const defined = await evaluator.evaluate(
      'async function g() { return await Promise.resolve(7) }',
    );
    expect(defined.ok).toBe(true);
    expect(await evaluator.evaluate('await g()')).toEqual({ ok: true, value: 7 });
  });

  it('persists declarations from multi-statement await input', async () => {
    const evaluator = createReplEvaluator({});
    const result = await evaluator.evaluate(
      'let total = 0; total = await Promise.resolve(4); total += 1;',
    );
    expect(result.ok).toBe(true);
    expect(await evaluator.evaluate('total')).toEqual({ ok: true, value: 5 });
  });

  it('keeps intrinsic identity inside the context', async () => {
    const evaluator = createReplEvaluator({});
    expect(await evaluator.evaluate('[1, 2] instanceof Array')).toEqual({ ok: true, value: true });
    expect(await evaluator.evaluate('({}) instanceof Object')).toEqual({ ok: true, value: true });
    expect(await evaluator.evaluate('Object.getPrototypeOf({}) === Object.prototype')).toEqual({
      ok: true,
      value: true,
    });
  });

  it('exposes Node globals like Buffer and crypto', async () => {
    const evaluator = createReplEvaluator({});
    expect(await evaluator.evaluate("Buffer.from('hi').toString('base64')")).toEqual({
      ok: true,
      value: 'aGk=',
    });
    const uuid = await evaluator.evaluate('crypto.randomUUID()');
    expect(uuid.ok).toBe(true);
  });

  it('does not report block-scoped loop variables as globals', async () => {
    const evaluator = createReplEvaluator({});
    await evaluator.evaluate('for (const looped of [1, 2]) { looped; }');
    expect(evaluator.globalNames()).not.toContain('looped');
  });

  it('reports destructured binding names as globals', async () => {
    const evaluator = createReplEvaluator({});
    await evaluator.evaluate('const { alpha, beta: renamed } = { alpha: 1, beta: 2 }');
    const names = evaluator.globalNames();
    expect(names).toContain('alpha');
    expect(names).toContain('renamed');
  });
});

describe('materializeResult', () => {
  const executed: unknown[] = [];
  const executePlan = async (plan: unknown) => {
    executed.push(plan);
    return [{ id: 1 }];
  };
  const plan = { ast: { kind: 'select' }, meta: { lane: 'sql' }, params: [] };

  it('passes through scalars and plain objects', async () => {
    expect(await materializeResult(42, executePlan)).toEqual({ value: 42, executed: false });
    expect(await materializeResult(null, executePlan)).toEqual({ value: null, executed: false });
  });

  it('awaits thenables', async () => {
    const result = await materializeResult(Promise.resolve('hi'), executePlan);
    expect(result).toEqual({ value: 'hi', executed: false });
  });

  it('executes query plans (ast + params + lane-tagged meta)', async () => {
    const result = await materializeResult(plan, executePlan);
    expect(result).toEqual({ value: [{ id: 1 }], executed: true });
  });

  it('builds and executes builders exposing build() plus chain methods', async () => {
    const builder = { build: () => plan, where: () => builder, orderBy: () => builder };
    const result = await materializeResult(builder, executePlan);
    expect(result).toEqual({ value: [{ id: 1 }], executed: true });
  });

  it('runs orm collections exposing all(), where(), and include()', async () => {
    const collection = {
      where: () => collection,
      include: () => collection,
      all: async () => [{ email: 'a@b.c' }],
    };
    const result = await materializeResult(collection, executePlan);
    expect(result).toEqual({ value: [{ email: 'a@b.c' }], executed: true });
  });

  it('awaits a thenable that resolves to a plan and executes it', async () => {
    const result = await materializeResult(Promise.resolve(plan), executePlan);
    expect(result).toEqual({ value: [{ id: 1 }], executed: true });
  });

  it('does not execute user objects that merely have a build method', async () => {
    const config = { build: () => 'artifact' };
    const result = await materializeResult(config, executePlan);
    expect(result).toEqual({ value: config, executed: false });
  });

  it('does not send plan-shaped plain data to the database', async () => {
    const blob = { ast: 'not-an-object', meta: {}, params: [] };
    const result = await materializeResult(blob, executePlan);
    expect(result).toEqual({ value: blob, executed: false });
  });
});
