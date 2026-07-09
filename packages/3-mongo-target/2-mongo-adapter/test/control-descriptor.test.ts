import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { mongoDescriptorById } from '../src/core/codecs';
import mongoAdapterDescriptor, { mongoScalarAuthoringTypes } from '../src/exports/control';

describe('mongoScalarAuthoringTypes', () => {
  const legacyMap = mongoAdapterDescriptor.scalarTypeDescriptors;
  const namespace: AuthoringTypeNamespace = mongoScalarAuthoringTypes;

  it('mirrors every legacy scalar as a zero-arg type constructor with manifest-derived nativeType', () => {
    if (!legacyMap) throw new Error('expected mongo adapter scalarTypeDescriptors');
    expect(Object.keys(namespace).sort()).toEqual([...legacyMap.keys()].sort());
    for (const [name, codecId] of legacyMap) {
      expect(namespace[name]).toEqual({
        kind: 'typeConstructor',
        output: { codecId, nativeType: mongoDescriptorById(codecId)?.targetTypes?.[0] },
      });
    }
  });

  it('is wired as the adapter descriptor authoring type contribution', () => {
    expect(mongoAdapterDescriptor.authoring?.type).toBe(mongoScalarAuthoringTypes);
  });
});
