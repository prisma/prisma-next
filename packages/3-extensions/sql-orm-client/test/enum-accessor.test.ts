import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { buildEnumsMap, createEnumAccessor } from '../src/enum-accessor';
import { orm } from '../src/orm';
import { createMockRuntime } from './helpers';

const roleEnum = {
  codecId: 'pg/text@1',
  members: [
    { name: 'User', value: 'user' },
    { name: 'Admin', value: 'admin' },
  ],
} as const;

const statusEnum = {
  codecId: 'pg/text@1',
  members: [
    { name: 'Active', value: 'active' },
    { name: 'Inactive', value: 'inactive' },
    { name: 'Pending', value: 'pending' },
  ],
} as const;

describe('createEnumAccessor()', () => {
  describe('.values', () => {
    it('returns member values in declaration order', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.values).toEqual(['user', 'admin']);
    });

    it('preserves declaration order with more than two members', () => {
      const accessor = createEnumAccessor(statusEnum);
      expect(accessor.values).toEqual(['active', 'inactive', 'pending']);
    });
  });

  describe('.names', () => {
    it('returns member names in declaration order', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.names).toEqual(['User', 'Admin']);
    });
  });

  describe('.members', () => {
    it('maps member names to their values', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.members).toEqual({ User: 'user', Admin: 'admin' });
    });

    it('resolves each member name to the correct value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.members['User']).toBe('user');
      expect(accessor.members['Admin']).toBe('admin');
    });
  });

  describe('.has()', () => {
    it('returns true for a declared member value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.has('user')).toBe(true);
      expect(accessor.has('admin')).toBe(true);
    });

    it('returns false for an undeclared value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.has('superadmin')).toBe(false);
      expect(accessor.has('')).toBe(false);
    });

    it('is case-sensitive', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.has('User')).toBe(false);
      expect(accessor.has('ADMIN')).toBe(false);
    });
  });

  describe('.nameOf()', () => {
    it('returns the member name for a declared value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.nameOf('user')).toBe('User');
      expect(accessor.nameOf('admin')).toBe('Admin');
    });

    it('returns undefined for an undeclared value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.nameOf('superadmin')).toBeUndefined();
    });
  });

  describe('.ordinalOf()', () => {
    it('returns the zero-based declaration index for a declared value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.ordinalOf('user')).toBe(0);
      expect(accessor.ordinalOf('admin')).toBe(1);
    });

    it('returns -1 for an undeclared value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.ordinalOf('superadmin')).toBe(-1);
    });

    it('preserves declaration order across three members', () => {
      const accessor = createEnumAccessor(statusEnum);
      expect(accessor.ordinalOf('active')).toBe(0);
      expect(accessor.ordinalOf('inactive')).toBe(1);
      expect(accessor.ordinalOf('pending')).toBe(2);
    });
  });
});

describe('buildEnumsMap()', () => {
  it('collects enums from all namespaces', () => {
    const domain = {
      namespaces: {
        public: {
          enum: { Role: roleEnum, Status: statusEnum },
        },
      },
    };

    const map = buildEnumsMap(domain);
    expect(Object.keys(map).sort()).toEqual(['Role', 'Status']);
    expect(map['Role']?.values).toEqual(['user', 'admin']);
    expect(map['Status']?.values).toEqual(['active', 'inactive', 'pending']);
  });

  it('returns an empty map when no namespaces have enums', () => {
    const domain = {
      namespaces: {
        public: { enum: {} },
      },
    };

    const map = buildEnumsMap(domain);
    expect(map).toEqual({});
  });

  it('merges enums from multiple namespaces', () => {
    const domain = {
      namespaces: {
        public: { enum: { Role: roleEnum } },
        audit: { enum: { Status: statusEnum } },
      },
    };

    const map = buildEnumsMap(domain);
    expect(Object.keys(map).sort()).toEqual(['Role', 'Status']);
  });
});

type EnumContract = Contract<SqlStorage> & {
  readonly enumAccessors: {
    readonly Role: ReturnType<typeof createEnumAccessor>;
    readonly Status: ReturnType<typeof createEnumAccessor>;
  };
};

describe('orm().enums', () => {
  function ormWithEnums() {
    const contract = {
      domain: {
        namespaces: {
          public: { models: {}, enum: { Role: roleEnum, Status: statusEnum } },
        },
      },
    } as unknown as EnumContract;
    const context = { contract } as unknown as ExecutionContext<EnumContract>;
    return orm({ runtime: createMockRuntime(), context });
  }

  it('resolves db.enums.<Name> to the enum accessor', () => {
    const db = ormWithEnums();
    expect(db.enums.Role.values).toEqual(['user', 'admin']);
    expect(db.enums.Status.values).toEqual(['active', 'inactive', 'pending']);
  });

  it('exposes the member accessors and helpers through db.enums', () => {
    const db = ormWithEnums();
    expect(db.enums.Role.members['User']).toBe('user');
    expect(db.enums.Role.has('admin')).toBe(true);
    expect(db.enums.Role.nameOf('user')).toBe('User');
    expect(db.enums.Role.ordinalOf('admin')).toBe(1);
  });

  it('returns the same enums object on repeated access', () => {
    const db = ormWithEnums();
    expect(db.enums).toBe(db.enums);
  });
});
