import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../src/contract';
import { orm } from '../src/orm';
import type { Adapter, LoweredStatement, SelectAst } from '../src/types';
import type { CodecTypes, Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(ast: SelectAst, ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

describe('orm entrypoint', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const codecTypes = {} as CodecTypes;

  it('exposes valid model names as properties', () => {
    const o = orm<Contract, CodecTypes>({ contract, adapter, codecTypes });

    expect(o).toHaveProperty('user');
    expect(typeof (o as { user: () => unknown }).user).toBe('function');
  });

  it('returns OrmModelBuilder when accessing model', () => {
    const o = orm<Contract, CodecTypes>({ contract, adapter, codecTypes });

    const builder = (o as { user: () => unknown }).user();

    expect(builder).toBeDefined();
    expect(typeof builder.where).toBe('function');
    expect(typeof builder.select).toBe('function');
    expect(typeof builder.findMany).toBe('function');
  });

  it('throws error when accessing invalid model at runtime', () => {
    const o = orm<Contract, CodecTypes>({ contract, adapter, codecTypes });

    expect(() => {
      (o as unknown as { invalidModel: () => unknown }).invalidModel();
    }).toThrow();
  });
});
