import type { ContractSourceProvider } from '@prisma-next/config/config-types';
import { ok } from '@prisma-next/utils/result';
import { describe, expect, it } from 'vitest';
import { hasPslInterpreter, type PslInterpretCapable } from '../src/interpret';

const load: ContractSourceProvider['load'] = async () => ok({} as never);

describe('hasPslInterpreter', () => {
  it('accepts a psl provider carrying an interpret function', () => {
    const provider: PslInterpretCapable = {
      sourceFormat: 'psl',
      load,
      interpret: () => ok({} as never),
    };
    const source: ContractSourceProvider = provider;

    expect(hasPslInterpreter(source)).toBe(true);
  });

  it('exposes interpret on the narrowed source', () => {
    const provider: PslInterpretCapable = {
      sourceFormat: 'psl',
      load,
      interpret: () => ok({} as never),
    };
    const source: ContractSourceProvider = provider;

    if (!hasPslInterpreter(source)) {
      throw new Error('expected guard to accept the provider');
    }
    expect(source.interpret).toBe(provider.interpret);
  });

  it('rejects a typescript provider even when it carries an interpret function', () => {
    const provider = { sourceFormat: 'typescript' as const, load, interpret: () => [] };
    const source: ContractSourceProvider = provider;

    expect(hasPslInterpreter(source)).toBe(false);
  });

  it('rejects an opaque provider with an unknown sourceFormat carrying interpret', () => {
    const provider = { sourceFormat: 'made-up-format', load, interpret: () => [] };
    const source: ContractSourceProvider = provider;

    expect(hasPslInterpreter(source)).toBe(false);
  });

  it('rejects a provider without a sourceFormat', () => {
    const provider = { load, interpret: () => [] };
    const source: ContractSourceProvider = provider;

    expect(hasPslInterpreter(source)).toBe(false);
  });

  it('rejects a psl provider without an interpret method', () => {
    const source: ContractSourceProvider = { sourceFormat: 'psl', load };

    expect(hasPslInterpreter(source)).toBe(false);
  });

  it('rejects a psl provider whose interpret is not a function', () => {
    const provider = { sourceFormat: 'psl' as const, load, interpret: 'not-a-function' };
    const source: ContractSourceProvider = provider;

    expect(hasPslInterpreter(source)).toBe(false);
  });
});
