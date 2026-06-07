import { describe, expect, it } from 'vitest';
import type { ContractEnum, ContractField } from '../src/domain-types';
import type { ValueSetRef } from '../src/value-set-ref';

describe('ValueSetRef', () => {
  it('carries kind, namespaceId, and name', () => {
    const ref: ValueSetRef = {
      kind: 'enum',
      namespaceId: '__unbound__',
      name: 'Role',
    };
    expect(ref.kind).toBe('enum');
    expect(ref.namespaceId).toBe('__unbound__');
    expect(ref.name).toBe('Role');
  });

  it('accepts value-set kind', () => {
    const ref: ValueSetRef = {
      kind: 'value-set',
      namespaceId: 'public',
      name: 'Status',
    };
    expect(ref.kind).toBe('value-set');
  });

  it('cross-space ref carries spaceId', () => {
    const ref: ValueSetRef = {
      kind: 'enum',
      namespaceId: 'auth',
      name: 'Role',
      spaceId: 'other-space',
    };
    expect(ref.spaceId).toBe('other-space');
  });

  it('local ref omits spaceId', () => {
    const ref: ValueSetRef = {
      kind: 'enum',
      namespaceId: '__unbound__',
      name: 'Role',
    };
    expect('spaceId' in ref).toBe(false);
  });
});

describe('ContractEnum', () => {
  it('carries codecId and ordered members', () => {
    const e: ContractEnum = {
      codecId: 'pg/text@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    };
    expect(e.codecId).toBe('pg/text@1');
    expect(e.members).toHaveLength(2);
    expect(e.members[0]).toEqual({ name: 'User', value: 'user' });
    expect(e.members[1]).toEqual({ name: 'Admin', value: 'admin' });
  });

  it('members round-trip in declaration order', () => {
    const e: ContractEnum = {
      codecId: 'pg/text@1',
      members: [
        { name: 'Pending', value: 'pending' },
        { name: 'Active', value: 'active' },
        { name: 'Archived', value: 'archived' },
      ],
    };
    const names = e.members.map((m) => m.name);
    expect(names).toEqual(['Pending', 'Active', 'Archived']);
  });
});

describe('ContractField with valueSet', () => {
  it('accepts a valueSet restriction alongside a scalar type', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: {
        kind: 'enum',
        namespaceId: '__unbound__',
        name: 'Role',
      },
    };
    expect(field.valueSet).toBeDefined();
    expect(field.valueSet?.kind).toBe('enum');
    expect(field.valueSet?.name).toBe('Role');
  });

  it('ContractField without valueSet is unchanged', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
    };
    expect('valueSet' in field).toBe(false);
  });
});
