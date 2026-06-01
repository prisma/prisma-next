import {
  defaultDomainNamespaceIdForSqlTarget,
  domainModelsAtDefaultNamespace,
} from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';

describe('mongo defineContract wrap', () => {
  it('pre-binds family and target (definition form, no models)', () => {
    const result = defineContract({});
    expect(result.target).toBe('mongo');
    expect(result.targetFamily).toBe('mongo');
  });

  it('pre-binds family and target (factory form)', () => {
    const result = defineContract({}, ({ model: m, field: f }) => ({
      models: {
        Foo: m('Foo', { fields: { id: f.objectId() } }),
      },
    }));
    expect(result.target).toBe('mongo');
    expect(result.targetFamily).toBe('mongo');
    expect(
      domainModelsAtDefaultNamespace(
        result.domain,
        defaultDomainNamespaceIdForSqlTarget(result.target),
      )['Foo'],
    ).toBeDefined();
  });

  it('accepts extensionPacks: undefined', () => {
    const result = defineContract({ extensionPacks: undefined });
    expect(result.target).toBe('mongo');
  });

  it('produces a model when defined inline', () => {
    const result = defineContract({
      models: {
        Bar: model('Bar', { fields: { id: field.objectId() } }),
      },
    });
    expect(
      domainModelsAtDefaultNamespace(
        result.domain,
        defaultDomainNamespaceIdForSqlTarget(result.target),
      )['Bar'],
    ).toBeDefined();
  });
});
