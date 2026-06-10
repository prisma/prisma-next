import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { buildEnumsMapForNamespace, createEnumAccessor } from '../src/enum-accessor';
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

describe('buildEnumsMapForNamespace()', () => {
  it('collects only the requested namespace enums', () => {
    const domain = {
      namespaces: {
        public: {
          enum: { Role: roleEnum, Status: statusEnum },
        },
      },
    };

    const map = buildEnumsMapForNamespace(domain, 'public');
    expect(Object.keys(map).sort()).toEqual(['Role', 'Status']);
    expect(map['Role']?.values).toEqual(['user', 'admin']);
    expect(map['Status']?.values).toEqual(['active', 'inactive', 'pending']);
  });

  it('returns an empty map when the namespace has no enums', () => {
    const domain = {
      namespaces: {
        public: { enum: {} },
      },
    };

    expect(buildEnumsMapForNamespace(domain, 'public')).toEqual({});
  });

  it('returns an empty map for an unknown namespace', () => {
    const domain = {
      namespaces: {
        public: { enum: { Role: roleEnum } },
      },
    };

    expect(buildEnumsMapForNamespace(domain, 'audit')).toEqual({});
  });

  it('keeps same-named enums in different namespaces separate', () => {
    const domain = {
      namespaces: {
        public: { enum: { Role: roleEnum } },
        audit: { enum: { Role: statusEnum } },
      },
    };

    expect(buildEnumsMapForNamespace(domain, 'public')['Role']?.values).toEqual(['user', 'admin']);
    expect(buildEnumsMapForNamespace(domain, 'audit')['Role']?.values).toEqual([
      'active',
      'inactive',
      'pending',
    ]);
  });
});

// A literal-keyed domain so `db.public` is a literal facet (not an index
// signature), letting the runtime assertions below use dot access.
type EnumContract = Omit<Contract<SqlStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly public: {
        readonly models: Record<never, never>;
        readonly enum: {
          readonly Role: typeof roleEnum;
          readonly Status: typeof statusEnum;
        };
      };
    };
  };
};

describe('orm().<ns>.enums', () => {
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

  it('resolves db.<ns>.enums.<Name> to the enum accessor', () => {
    const db = ormWithEnums();
    expect(db.public.enums.Role.values).toEqual(['user', 'admin']);
    expect(db.public.enums.Status.values).toEqual(['active', 'inactive', 'pending']);
  });

  it('exposes the member accessors and helpers through db.<ns>.enums', () => {
    const db = ormWithEnums();
    expect(db.public.enums.Role.members['User']).toBe('user');
    expect(db.public.enums.Role.has('admin')).toBe(true);
    expect(db.public.enums.Role.nameOf('user')).toBe('User');
    expect(db.public.enums.Role.ordinalOf('admin')).toBe(1);
  });

  it('returns the same enums object on repeated access', () => {
    const db = ormWithEnums();
    expect(db.public.enums).toBe(db.public.enums);
  });

  it('resolves same-named enums per namespace, not last-write-wins', () => {
    const contract = {
      domain: {
        namespaces: {
          public: { models: {}, enum: { Role: roleEnum } },
          audit: { models: {}, enum: { Role: statusEnum } },
        },
      },
    } as unknown as EnumContract;
    const context = { contract } as unknown as ExecutionContext<EnumContract>;
    const db = orm({ runtime: createMockRuntime(), context });

    expect(db.public.enums.Role.values).toEqual(['user', 'admin']);
    expect(
      (db as unknown as { audit: { enums: { Role: { values: unknown } } } }).audit.enums.Role
        .values,
    ).toEqual(['active', 'inactive', 'pending']);
  });

  it('rejects a domain model named `enums` that would shadow the accessor', () => {
    const contract = {
      domain: {
        namespaces: {
          public: { models: { enums: {} }, enum: { Role: roleEnum } },
        },
      },
    } as unknown as EnumContract;
    const context = { contract } as unknown as ExecutionContext<EnumContract>;
    const db = orm({ runtime: createMockRuntime(), context });

    expect(() => db.public).toThrow(/reserved enum accessor/);
  });
});
