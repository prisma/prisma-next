import { describe, expect, it } from 'vitest';
import {
  errorAliasCollision,
  errorAliasPathEmpty,
  errorChildProjectionEmpty,
  errorChildProjectionMustBeSpecified,
  errorColumnNotFound,
  errorCreateRequiresFields,
  errorFailedToBuildWhereClause,
  errorIncludeAliasNotFound,
  errorIncludeCapabilitiesNotTrue,
  errorIncludeRequiresCapabilities,
  errorInvalidColumn,
  errorInvalidProjectionKey,
  errorInvalidProjectionValue,
  errorJoinColumnsMustBeDefined,
  errorMissingAlias,
  errorMissingColumn,
  errorMissingParameter,
  errorModelNotFound,
  errorMultiColumnJoinsNotSupported,
  errorProjectionEmpty,
  errorRelationNotFound,
  errorTableNotFound,
  errorUnknownColumn,
  errorUnknownTable,
  errorUpdateRequiresFields,
} from '../../src/utils/errors';

describe('error functions', () => {
  it('errorModelNotFound throws with correct message', () => {
    expect(() => errorModelNotFound('User')).toThrow('Model User not found in mappings');
  });

  it('errorTableNotFound throws with correct message', () => {
    expect(() => errorTableNotFound('user')).toThrow('Table user not found in schema');
  });

  it('errorUnknownTable throws with correct message', () => {
    expect(() => errorUnknownTable('user')).toThrow('Unknown table user');
  });

  it('errorUnknownColumn throws with correct message', () => {
    expect(() => errorUnknownColumn('email', 'user')).toThrow('Unknown column email in table user');
  });

  it('errorMissingParameter throws with correct message', () => {
    expect(() => errorMissingParameter('userId')).toThrow('Missing value for parameter userId');
  });

  it('errorAliasPathEmpty throws with correct message', () => {
    expect(() => errorAliasPathEmpty()).toThrow('Alias path cannot be empty');
  });

  it('errorAliasCollision throws with correct message', () => {
    expect(() => errorAliasCollision(['user', 'posts'], 'user_posts', ['user', 'post'])).toThrow(
      'Alias collision: path user.posts would generate alias "user_posts" which conflicts with path user.post',
    );
  });

  it('errorAliasCollision throws with unknown path when existingPath is undefined', () => {
    expect(() => errorAliasCollision(['user', 'posts'], 'user_posts')).toThrow(
      'Alias collision: path user.posts would generate alias "user_posts" which conflicts with path unknown',
    );
  });

  it('errorInvalidProjectionValue throws with correct message', () => {
    expect(() => errorInvalidProjectionValue(['user', 'email'])).toThrow(
      'Invalid projection value at path user.email: expected ColumnBuilder or nested object',
    );
  });

  it('errorIncludeAliasNotFound throws with correct message', () => {
    expect(() => errorIncludeAliasNotFound('posts')).toThrow(
      'Include alias "posts" not found. Did you call includeMany() with alias "posts"?',
    );
  });

  it('errorInvalidProjectionKey throws with correct message', () => {
    expect(() => errorInvalidProjectionKey('email')).toThrow(
      'Invalid projection value at key "email": expected ColumnBuilder, boolean true (for includes), or nested object',
    );
  });

  it('errorProjectionEmpty throws with correct message', () => {
    expect(() => errorProjectionEmpty()).toThrow(
      'select() requires at least one column or include',
    );
  });

  it('errorCreateRequiresFields throws with correct message', () => {
    expect(() => errorCreateRequiresFields()).toThrow('create() requires at least one field');
  });

  it('errorUpdateRequiresFields throws with correct message', () => {
    expect(() => errorUpdateRequiresFields()).toThrow('update() requires at least one field');
  });

  it('errorIncludeRequiresCapabilities throws with correct message', () => {
    expect(() => errorIncludeRequiresCapabilities()).toThrow(
      'includeMany requires lateral and jsonAgg capabilities',
    );
  });

  it('errorIncludeCapabilitiesNotTrue throws with correct message', () => {
    expect(() => errorIncludeCapabilitiesNotTrue()).toThrow(
      'includeMany requires lateral and jsonAgg capabilities to be true',
    );
  });

  it('errorMultiColumnJoinsNotSupported throws with correct message', () => {
    expect(() => errorMultiColumnJoinsNotSupported()).toThrow(
      'Multi-column joins in includes are not yet supported',
    );
  });

  it('errorJoinColumnsMustBeDefined throws with correct message', () => {
    expect(() => errorJoinColumnsMustBeDefined()).toThrow('Join columns must be defined');
  });

  it('errorColumnNotFound throws with correct message', () => {
    expect(() => errorColumnNotFound('email', 'user')).toThrow(
      'Column email not found in table user',
    );
  });

  it('errorChildProjectionMustBeSpecified throws with correct message', () => {
    expect(() => errorChildProjectionMustBeSpecified()).toThrow(
      'Child projection must be specified',
    );
  });

  it('errorChildProjectionEmpty throws with correct message', () => {
    expect(() => errorChildProjectionEmpty()).toThrow(
      'Child projection must not be empty after filtering boolean values',
    );
  });

  it('errorMissingAlias throws with correct message', () => {
    expect(() => errorMissingAlias(0)).toThrow('Missing alias at index 0');
  });

  it('errorMissingColumn throws with correct message', () => {
    expect(() => errorMissingColumn('user', 0)).toThrow('Missing column for alias user at index 0');
  });

  it('errorInvalidColumn throws with correct message', () => {
    expect(() => errorInvalidColumn('user', 0)).toThrow('Invalid column for alias user at index 0');
  });

  it('errorRelationNotFound throws with correct message', () => {
    expect(() => errorRelationNotFound('posts', 'User')).toThrow(
      'Relation posts not found on model User',
    );
  });

  it('errorFailedToBuildWhereClause throws with correct message', () => {
    expect(() => errorFailedToBuildWhereClause()).toThrow('Failed to build WHERE clause');
  });
});
