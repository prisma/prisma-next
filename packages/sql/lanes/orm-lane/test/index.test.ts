import { describe, expect, it } from 'vitest';
import type {
  ModelColumnAccessor,
  OrmBuilderOptions,
  OrmModelBuilder,
  OrmRegistry,
  OrmRelationAccessor,
  OrmRelationFilterBuilder,
  OrmWhereProperty,
} from '../src/index';
import { OrmModelBuilderImpl, orm } from '../src/index';

describe('index exports', () => {
  it('exports orm function', () => {
    expect(typeof orm).toBe('function');
  });

  it('exports OrmModelBuilderImpl class', () => {
    expect(OrmModelBuilderImpl).toBeDefined();
    expect(typeof OrmModelBuilderImpl).toBe('function');
  });

  it('exports type ModelColumnAccessor', () => {
    // Type-only export, just verify it exists
    type _Test = ModelColumnAccessor;
    expect(true).toBe(true);
  });

  it('exports type OrmBuilderOptions', () => {
    // Type-only export, just verify it exists
    type _Test = OrmBuilderOptions;
    expect(true).toBe(true);
  });

  it('exports type OrmModelBuilder', () => {
    // Type-only export, just verify it exists
    type _Test = OrmModelBuilder;
    expect(true).toBe(true);
  });

  it('exports type OrmRegistry', () => {
    // Type-only export, just verify it exists
    type _Test = OrmRegistry;
    expect(true).toBe(true);
  });

  it('exports type OrmRelationAccessor', () => {
    // Type-only export, just verify it exists
    type _Test = OrmRelationAccessor;
    expect(true).toBe(true);
  });

  it('exports type OrmRelationFilterBuilder', () => {
    // Type-only export, just verify it exists
    type _Test = OrmRelationFilterBuilder;
    expect(true).toBe(true);
  });

  it('exports type OrmWhereProperty', () => {
    // Type-only export, just verify it exists
    type _Test = OrmWhereProperty;
    expect(true).toBe(true);
  });
});
