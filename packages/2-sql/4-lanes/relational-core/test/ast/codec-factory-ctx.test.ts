import type { CodecCallContext } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codec } from '../../src/ast/codec-types';

describe('codec() factory — CodecCallContext arity', () => {
  it('lifts a single-arg `(value)` author unchanged (back-compat)', async () => {
    const c = codec({
      typeId: 'demo/single-arg-encode@1',
      targetTypes: ['text'],
      encode: (value: string) => value.toUpperCase(),
      decode: (wire: string) => wire,
    });
    expect(await c.encode!('hi')).toBe('HI');
  });

  it('forwards ctx to a `(value, ctx)` encode author', async () => {
    let observed: CodecCallContext | undefined;
    const c = codec({
      typeId: 'demo/ctx-encode@1',
      targetTypes: ['text'],
      encode: (value: string, ctx?: CodecCallContext) => {
        observed = ctx;
        return value;
      },
      decode: (wire: string) => wire,
    });
    const controller = new AbortController();
    const ctx: CodecCallContext = {
      signal: controller.signal,
      column: { table: 'users', name: 'email' },
    };
    await c.encode!('x', ctx);
    expect(observed).toBe(ctx);
    expect(observed?.signal).toBe(controller.signal);
    expect(observed?.column).toEqual({ table: 'users', name: 'email' });
  });

  it('forwards ctx to a `(value, ctx)` decode author', async () => {
    let observed: CodecCallContext | undefined;
    const c = codec({
      typeId: 'demo/ctx-decode@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string, ctx?: CodecCallContext) => {
        observed = ctx;
        return wire;
      },
    });
    const controller = new AbortController();
    const ctx: CodecCallContext = {
      signal: controller.signal,
      column: { table: 'orders', name: 'total' },
    };
    await c.decode('x', ctx);
    expect(observed).toBe(ctx);
    expect(observed?.signal).toBe(controller.signal);
    expect(observed?.column).toEqual({ table: 'orders', name: 'total' });
  });

  it('preserves AbortSignal identity through the lifted method', async () => {
    let observedSignal: AbortSignal | undefined;
    const c = codec({
      typeId: 'demo/identity@1',
      targetTypes: ['text'],
      encode: (value: string, ctx?: CodecCallContext) => {
        observedSignal = ctx?.signal;
        return value;
      },
      decode: (wire: string) => wire,
    });
    const controller = new AbortController();
    await c.encode!('x', { signal: controller.signal });
    expect(observedSignal).toBe(controller.signal);
  });

  it('omitted ctx surfaces as undefined to a ctx-bearing author', async () => {
    let observed: unknown = 'sentinel';
    const c = codec({
      typeId: 'demo/undef-ctx@1',
      targetTypes: ['text'],
      encode: (value: string, ctx?: CodecCallContext) => {
        observed = ctx;
        return value;
      },
      decode: (wire: string) => wire,
    });
    await c.encode!('x');
    expect(observed).toBeUndefined();
  });

  it('async ctx-bearing encode resolves with the produced value', async () => {
    const c = codec({
      typeId: 'demo/async-ctx@1',
      targetTypes: ['text'],
      encode: async (value: string, _ctx?: CodecCallContext) => `enc:${value}`,
      decode: (wire: string) => wire,
    });
    expect(await c.encode!('x', { signal: new AbortController().signal })).toBe('enc:x');
  });

  it('identity default for omitted encode still works (single-arg call site)', async () => {
    const c = codec({
      typeId: 'demo/identity-default-ctx@1',
      targetTypes: ['text'],
      decode: (wire: string) => wire,
    });
    expect(await c.encode!('hi')).toBe('hi');
    expect(await c.encode!('hi', { signal: new AbortController().signal })).toBe('hi');
  });
});
