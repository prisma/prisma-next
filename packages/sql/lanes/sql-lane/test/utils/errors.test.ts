import { describe, expect, it } from 'vitest';
import {
  errorAliasCollision,
  errorAliasPathEmpty,
  errorChildProjectionEmpty,
  errorChildProjectionMustBeSpecified,
  errorFailedToBuildWhereClause,
  errorFromMustBeCalled,
  errorIncludeAliasCollision,
  errorIncludeAliasNotFound,
  errorIncludeCapabilitiesNotTrue,
  errorIncludeRequiresCapabilities,
  errorInvalidColumnForAlias,
  errorInvalidProjectionKey,
  errorInvalidProjectionValue,
  errorLimitMustBeNonNegativeInteger,
  errorMissingAlias,
  errorMissingColumnForAlias,
  errorMissingParameter,
  errorProjectionEmpty,
  errorReturningCapabilityNotTrue,
  errorReturningRequiresCapability,
  errorSelectMustBeCalled,
  errorSelfJoinNotSupported,
  errorUnknownColumn,
  errorUnknownTable,
  errorWhereMustBeCalledForDelete,
  errorWhereMustBeCalledForUpdate,
} from '../../src/utils/errors';

describe('error functions', () => {
  it('errorAliasPathEmpty throws PLAN.INVALID', () => {
    expect(() => errorAliasPathEmpty()).toThrow('Alias path cannot be empty');
    try {
      errorAliasPathEmpty();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorAliasCollision throws PLAN.INVALID with path details', () => {
    expect(() => errorAliasCollision(['user', 'id'], 'user_id', ['user', 'name'])).toThrow(
      'Alias collision: path user.id would generate alias "user_id" which conflicts with path user.name',
    );
    try {
      errorAliasCollision(['user', 'id'], 'user_id', ['user', 'name']);
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorAliasCollision handles undefined existingPath', () => {
    expect(() => errorAliasCollision(['user', 'id'], 'user_id')).toThrow(
      'Alias collision: path user.id would generate alias "user_id" which conflicts with path unknown',
    );
    try {
      errorAliasCollision(['user', 'id'], 'user_id');
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorLimitMustBeNonNegativeInteger throws PLAN.INVALID', () => {
    expect(() => errorLimitMustBeNonNegativeInteger()).toThrow(
      'Limit must be a non-negative integer',
    );
    try {
      errorLimitMustBeNonNegativeInteger();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorChildProjectionMustBeSpecified throws PLAN.INVALID', () => {
    expect(() => errorChildProjectionMustBeSpecified()).toThrow(
      'Child projection must be specified',
    );
    try {
      errorChildProjectionMustBeSpecified();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorChildProjectionEmpty throws PLAN.INVALID', () => {
    expect(() => errorChildProjectionEmpty()).toThrow('Child projection must not be empty');
    try {
      errorChildProjectionEmpty();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorIncludeRequiresCapabilities throws PLAN.INVALID', () => {
    expect(() => errorIncludeRequiresCapabilities()).toThrow(
      'includeMany requires lateral and jsonAgg capabilities',
    );
    try {
      errorIncludeRequiresCapabilities();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorIncludeCapabilitiesNotTrue throws PLAN.INVALID', () => {
    expect(() => errorIncludeCapabilitiesNotTrue()).toThrow(
      'includeMany requires lateral and jsonAgg capabilities to be true',
    );
    try {
      errorIncludeCapabilitiesNotTrue();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorUnknownTable throws PLAN.INVALID with table name', () => {
    expect(() => errorUnknownTable('nonexistent')).toThrow('Unknown table nonexistent');
    try {
      errorUnknownTable('nonexistent');
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorSelfJoinNotSupported throws PLAN.INVALID', () => {
    expect(() => errorSelfJoinNotSupported()).toThrow('Self-joins are not supported in MVP');
    try {
      errorSelfJoinNotSupported();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorIncludeAliasCollision throws PLAN.INVALID with alias and type', () => {
    expect(() => errorIncludeAliasCollision('posts', 'projection')).toThrow(
      'Alias collision: include alias "posts" conflicts with existing projection alias',
    );
    try {
      errorIncludeAliasCollision('posts', 'projection');
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }

    expect(() => errorIncludeAliasCollision('posts', 'include')).toThrow(
      'Alias collision: include alias "posts" conflicts with existing include alias',
    );
    try {
      errorIncludeAliasCollision('posts', 'include');
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorMissingColumnForAlias throws PLAN.INVALID with alias and index', () => {
    expect(() => errorMissingColumnForAlias('user_id', 0)).toThrow(
      'Missing column for alias user_id at index 0',
    );
    try {
      errorMissingColumnForAlias('user_id', 0);
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorMissingAlias throws PLAN.INVALID with index', () => {
    expect(() => errorMissingAlias(0)).toThrow('Missing alias at index 0');
    try {
      errorMissingAlias(0);
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorInvalidColumnForAlias throws PLAN.INVALID with alias and index', () => {
    expect(() => errorInvalidColumnForAlias('user_id', 0)).toThrow(
      'Invalid column for alias user_id at index 0',
    );
    try {
      errorInvalidColumnForAlias('user_id', 0);
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorFromMustBeCalled throws PLAN.INVALID', () => {
    expect(() => errorFromMustBeCalled()).toThrow('from() must be called before building a query');
    try {
      errorFromMustBeCalled();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorSelectMustBeCalled throws PLAN.INVALID', () => {
    expect(() => errorSelectMustBeCalled()).toThrow('select() must be called before build()');
    try {
      errorSelectMustBeCalled();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorMissingParameter throws PLAN.INVALID with param name', () => {
    expect(() => errorMissingParameter('userId')).toThrow('Missing value for parameter userId');
    try {
      errorMissingParameter('userId');
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorInvalidProjectionValue throws PLAN.INVALID with path', () => {
    expect(() => errorInvalidProjectionValue(['user', 'id'])).toThrow(
      'Invalid projection value at path user.id: expected ColumnBuilder or nested object',
    );
    try {
      errorInvalidProjectionValue(['user', 'id']);
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorIncludeAliasNotFound throws PLAN.INVALID with alias', () => {
    expect(() => errorIncludeAliasNotFound('posts')).toThrow(
      'Include alias "posts" not found. Did you call includeMany() with alias "posts"?',
    );
    try {
      errorIncludeAliasNotFound('posts');
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorInvalidProjectionKey throws PLAN.INVALID with key', () => {
    expect(() => errorInvalidProjectionKey('invalid')).toThrow(
      'Invalid projection value at key "invalid": expected ColumnBuilder, boolean true (for includes), or nested object',
    );
    try {
      errorInvalidProjectionKey('invalid');
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorProjectionEmpty throws PLAN.INVALID', () => {
    expect(() => errorProjectionEmpty()).toThrow(
      'select() requires at least one column or include',
    );
    try {
      errorProjectionEmpty();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorReturningRequiresCapability throws PLAN.INVALID', () => {
    expect(() => errorReturningRequiresCapability()).toThrow(
      'returning() requires returning capability',
    );
    try {
      errorReturningRequiresCapability();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorReturningCapabilityNotTrue throws PLAN.INVALID', () => {
    expect(() => errorReturningCapabilityNotTrue()).toThrow(
      'returning() requires returning capability to be true',
    );
    try {
      errorReturningCapabilityNotTrue();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorUnknownColumn throws PLAN.INVALID with column and table names', () => {
    expect(() => errorUnknownColumn('nonexistent', 'user')).toThrow(
      'Unknown column nonexistent in table user',
    );
    try {
      errorUnknownColumn('nonexistent', 'user');
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorWhereMustBeCalledForUpdate throws PLAN.INVALID', () => {
    expect(() => errorWhereMustBeCalledForUpdate()).toThrow(
      'where() must be called before building an UPDATE query',
    );
    try {
      errorWhereMustBeCalledForUpdate();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorFailedToBuildWhereClause throws PLAN.INVALID', () => {
    expect(() => errorFailedToBuildWhereClause()).toThrow('Failed to build WHERE clause');
    try {
      errorFailedToBuildWhereClause();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });

  it('errorWhereMustBeCalledForDelete throws PLAN.INVALID', () => {
    expect(() => errorWhereMustBeCalledForDelete()).toThrow(
      'where() must be called before building a DELETE query',
    );
    try {
      errorWhereMustBeCalledForDelete();
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PLAN.INVALID');
    }
  });
});
