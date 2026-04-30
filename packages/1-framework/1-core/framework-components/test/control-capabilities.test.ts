import type { PslDocumentAst } from '@prisma-next/psl-types';
import { describe, expect, it } from 'vitest';
import { hasPslContractInfer, hasSchemaView } from '../src/control-capabilities';
import type { ControlFamilyInstance } from '../src/control-instances';

const SYNTHETIC_AST: PslDocumentAst = {
  kind: 'document',
  sourceId: 'test',
  models: [],
  enums: [],
  compositeTypes: [],
  span: {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 0, line: 1, column: 1 },
  },
};

const baseInstance: ControlFamilyInstance<'sql', unknown> = {
  familyId: 'sql',
  validateContract: (raw: unknown) => raw as never,
  introspect: async () => ({}) as unknown,
} as unknown as ControlFamilyInstance<'sql', unknown>;

describe('hasPslContractInfer', () => {
  it('returns true when instance exposes inferPslContract function', () => {
    const instance = {
      ...baseInstance,
      inferPslContract: (_schemaIR: unknown) => SYNTHETIC_AST,
    } as ControlFamilyInstance<'sql', unknown>;

    expect(hasPslContractInfer(instance)).toBe(true);
  });

  it('returns false when instance does not declare inferPslContract', () => {
    expect(hasPslContractInfer(baseInstance)).toBe(false);
  });

  it('returns false when inferPslContract is present but not a function', () => {
    const instance = {
      ...baseInstance,
      inferPslContract: 'not a function',
    } as unknown as ControlFamilyInstance<'sql', unknown>;

    expect(hasPslContractInfer(instance)).toBe(false);
  });
});

describe('hasSchemaView', () => {
  it('returns true when instance exposes toSchemaView function', () => {
    const instance = {
      ...baseInstance,
      toSchemaView: () => ({}) as never,
    } as ControlFamilyInstance<'sql', unknown>;

    expect(hasSchemaView(instance)).toBe(true);
  });

  it('returns false when instance does not declare toSchemaView', () => {
    expect(hasSchemaView(baseInstance)).toBe(false);
  });
});
