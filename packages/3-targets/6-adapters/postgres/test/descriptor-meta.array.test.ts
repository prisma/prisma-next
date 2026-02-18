import type { RenderTypeContext } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { PG_ARRAY_CODEC_ID } from '../src/core/codec-ids';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';

const renderers = postgresAdapterDescriptorMeta.types.codecTypes.parameterized;
const arrayRenderer = renderers[PG_ARRAY_CODEC_ID] as {
  kind: string;
  render: (params: Record<string, unknown>, ctx: RenderTypeContext) => string;
};

const ctx: RenderTypeContext = { codecTypesName: 'CodecTypes' };

describe('array parameterized type renderer', () => {
  it('is registered as a function renderer', () => {
    expect(arrayRenderer).toBeDefined();
    expect(arrayRenderer.kind).toBe('function');
  });

  it('renders Array<ElementType> for non-nullable items', () => {
    const result = arrayRenderer.render(
      { element: { codecId: 'pg/int4@1', nativeType: 'int4' } },
      ctx,
    );

    expect(result).toBe("Array<CodecTypes['pg/int4@1']['output']>");
  });

  it('renders Array<ElementType | null> for nullable items', () => {
    const result = arrayRenderer.render(
      { element: { codecId: 'pg/text@1', nativeType: 'text' }, nullableElement: true },
      ctx,
    );

    expect(result).toBe("Array<CodecTypes['pg/text@1']['output'] | null>");
  });

  it('uses the provided codecTypesName from context', () => {
    const customCtx: RenderTypeContext = { codecTypesName: 'MyTypes' };

    const result = arrayRenderer.render(
      { element: { codecId: 'pg/float8@1', nativeType: 'float8' } },
      customCtx,
    );

    expect(result).toBe("Array<MyTypes['pg/float8@1']['output']>");
  });
});

describe('array storage type entry', () => {
  it('includes pg/array@1 in storage types', () => {
    const arrayEntry = postgresAdapterDescriptorMeta.types.storage.find(
      (entry) => entry.typeId === PG_ARRAY_CODEC_ID,
    );

    expect(arrayEntry).toBeDefined();
    expect(arrayEntry?.familyId).toBe('sql');
    expect(arrayEntry?.targetId).toBe('postgres');
  });
});

describe('array codec control hooks', () => {
  it('registers control hooks for pg/array@1', () => {
    const hooks = postgresAdapterDescriptorMeta.types.codecTypes.controlPlaneHooks;
    expect(hooks[PG_ARRAY_CODEC_ID]).toBeDefined();
    expect(hooks[PG_ARRAY_CODEC_ID].expandNativeType).toBeDefined();
  });
});
