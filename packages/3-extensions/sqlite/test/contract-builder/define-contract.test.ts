import { contractModels } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';

const textColumn = {
  codecId: 'sql/char@1' as const,
  nativeType: 'character varying' as const,
  typeParams: {},
};

describe('sqlite defineContract wrap', () => {
  it('pre-binds family and target (no factory form)', () => {
    const result = defineContract({});
    expect(result.target).toBe('sqlite');
    expect(result.targetFamily).toBe('sql');
  });

  it('pre-binds family and target (factory form)', () => {
    const result = defineContract({}, ({ field: f, model: m }) => ({
      models: {
        Foo: m('Foo', { fields: { id: f.id.uuidv4() } }),
      },
    }));
    expect(result.target).toBe('sqlite');
    expect(result.targetFamily).toBe('sql');
    expect(contractModels(result)['Foo']).toBeDefined();
  });

  it('accepts extensionPacks: undefined', () => {
    const result = defineContract({ extensionPacks: undefined });
    expect(result.target).toBe('sqlite');
  });

  it('produces a model when defined inline', () => {
    const result = defineContract({
      models: {
        Bar: model('Bar', { fields: { id: field.column(textColumn).id() } }),
      },
    });
    expect(contractModels(result)['Bar']).toBeDefined();
  });
});
