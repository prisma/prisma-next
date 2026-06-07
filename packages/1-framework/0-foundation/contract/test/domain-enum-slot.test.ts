import { describe, expect, it } from 'vitest';
import type { ApplicationDomainNamespace } from '../src/domain-envelope';
import type { ContractEnum, ContractModelBase } from '../src/domain-types';

describe('ApplicationDomainNamespace enum slot', () => {
  it('accepts an enum slot alongside models', () => {
    const roleEnum: ContractEnum = {
      codecId: 'pg/text@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    };

    const ns: ApplicationDomainNamespace<Record<string, ContractModelBase>> = {
      models: {
        Post: { fields: {}, relations: {}, storage: {} },
      },
      enum: {
        Role: roleEnum,
      },
    };

    expect(ns.enum?.['Role']).toBeDefined();
    expect(ns.enum?.['Role']?.members[0]?.name).toBe('User');
    expect(ns.enum?.['Role']?.members[1]?.name).toBe('Admin');
  });

  it('enum slot is optional — existing namespace without enum is valid', () => {
    const ns: ApplicationDomainNamespace<Record<string, ContractModelBase>> = {
      models: {
        User: { fields: {}, relations: {}, storage: {} },
      },
    };

    expect(ns.enum).toBeUndefined();
  });
});
