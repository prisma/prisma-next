import { describe, expect, it } from 'vitest';
import {
  deriveBackRelationFieldName,
  deriveRelationFieldName,
  pluralize,
  toEnumName,
  toFieldName,
  toModelName,
  toNamedTypeName,
} from '../src/name-transforms';

describe('toModelName', () => {
  it('converts snake_case to PascalCase', () => {
    expect(toModelName('user_profile')).toEqual({ name: 'UserProfile', map: 'user_profile' });
  });

  it('capitalizes lowercase single word', () => {
    expect(toModelName('user')).toEqual({ name: 'User', map: 'user' });
  });

  it('preserves PascalCase', () => {
    expect(toModelName('UserProfile')).toEqual({ name: 'UserProfile' });
  });

  it('escapes PSL reserved words', () => {
    expect(toModelName('model')).toEqual({ name: '_Model', map: 'model' });
    expect(toModelName('type')).toEqual({ name: '_Type', map: 'type' });
    expect(toModelName('enum')).toEqual({ name: '_Enum', map: 'enum' });
  });

  it('escapes digit-prefixed names', () => {
    expect(toModelName('3d_model')).toEqual({ name: '_3dModel', map: '3d_model' });
  });

  it('no map when name is already PascalCase', () => {
    expect(toModelName('User')).toEqual({ name: 'User' });
  });
});

describe('toFieldName', () => {
  it('converts snake_case to camelCase', () => {
    expect(toFieldName('user_id')).toEqual({ name: 'userId', map: 'user_id' });
  });

  it('preserves camelCase without map', () => {
    expect(toFieldName('userId')).toEqual({ name: 'userId' });
  });

  it('no map when already correct', () => {
    expect(toFieldName('id')).toEqual({ name: 'id' });
    expect(toFieldName('email')).toEqual({ name: 'email' });
  });

  it('escapes reserved words', () => {
    expect(toFieldName('model')).toEqual({ name: '_model', map: 'model' });
  });

  it('escapes digit-prefixed', () => {
    expect(toFieldName('2fa_code')).toEqual({ name: '_2faCode', map: '2fa_code' });
  });

  it('lowercases first char of PascalCase column name', () => {
    expect(toFieldName('Name')).toEqual({ name: 'name', map: 'Name' });
  });
});

describe('toEnumName', () => {
  it('converts snake_case to PascalCase', () => {
    expect(toEnumName('user_role')).toEqual({ name: 'UserRole', map: 'user_role' });
  });

  it('no map when already PascalCase', () => {
    expect(toEnumName('Role')).toEqual({ name: 'Role' });
  });
});

describe('pluralize', () => {
  it('adds s for regular words', () => {
    expect(pluralize('post')).toBe('posts');
    expect(pluralize('user')).toBe('users');
  });

  it('handles words ending in y', () => {
    expect(pluralize('category')).toBe('categories');
    expect(pluralize('company')).toBe('companies');
  });

  it('handles words ending in s/x/z/ch/sh', () => {
    expect(pluralize('address')).toBe('addresses');
    expect(pluralize('box')).toBe('boxes');
    expect(pluralize('batch')).toBe('batches');
    expect(pluralize('flash')).toBe('flashes');
  });

  it('does not double-pluralize vowel+y', () => {
    expect(pluralize('day')).toBe('days');
    expect(pluralize('key')).toBe('keys');
  });
});

describe('deriveRelationFieldName', () => {
  it('strips _id suffix for single column FK', () => {
    expect(deriveRelationFieldName(['user_id'], 'user')).toBe('user');
  });

  it('strips Id suffix for single column FK', () => {
    expect(deriveRelationFieldName(['authorId'], 'user')).toBe('author');
  });

  it('handles compound suffix stripping', () => {
    expect(deriveRelationFieldName(['parent_category_id'], 'category')).toBe('parentCategory');
  });

  it('uses referenced table name for composite FKs', () => {
    expect(deriveRelationFieldName(['cat_id', 'prod_id'], 'product')).toBe('product');
  });

  it('falls back to table name when no suffix to strip', () => {
    expect(deriveRelationFieldName(['author'], 'user')).toBe('user');
  });
});

describe('deriveBackRelationFieldName', () => {
  it('pluralizes for 1:N', () => {
    expect(deriveBackRelationFieldName('Post', false)).toBe('posts');
  });

  it('singularizes for 1:1', () => {
    expect(deriveBackRelationFieldName('Profile', true)).toBe('profile');
  });
});

describe('toNamedTypeName', () => {
  it('converts column name to PascalCase', () => {
    expect(toNamedTypeName('email')).toBe('Email');
    expect(toNamedTypeName('phone_number')).toBe('PhoneNumber');
  });
});
