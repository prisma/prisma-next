// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../prisma/contract.d';
import { ContractView } from './ContractView';

function buildContract(overrides?: Partial<Contract>): Contract {
  const base = {
    storageHash: 'storage_hash',
    target: 'postgres',
    targetFamily: 'sql',
    models: {
      user: {
        storage: { table: 'users' },
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
      },
    },
    storage: {
      tables: {
        users: {
          primaryKey: { columns: ['id'] },
          columns: {
            id: { nativeType: 'uuid', nullable: false, codecId: 'pg/uuid@1' },
            email: { nativeType: 'text', nullable: false, codecId: 'pg/text@1' },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    },
    relations: {
      users: {},
    },
    mappings: {
      modelToTable: { user: 'users' },
      tableToModel: { users: 'user' },
      fieldToColumn: { user: { id: 'id', email: 'email' } },
      columnToField: { users: { id: 'id', email: 'email' } },
    },
    capabilities: {
      sql: { returning: true },
    },
    extensionPacks: {
      pgvector: {},
    },
  } as unknown as Contract;

  return { ...base, ...overrides };
}

describe('ContractView', () => {
  it('renders expected section headings and badges', () => {
    const contract = buildContract();
    render(<ContractView contract={contract} />);

    expect(screen.getByText('Target: postgres')).toBeDefined();
    expect(screen.getByText('Models')).toBeDefined();
    expect(screen.getByText('Tables')).toBeDefined();
    expect(screen.getByText('Capabilities')).toBeDefined();
    expect(screen.getByText('Extensions')).toBeDefined();
    expect(screen.getByText('sql/returning')).toBeDefined();
    expect(screen.getByText('pgvector')).toBeDefined();
  });

  it('renders untrusted values as text content (no XSS)', () => {
    const untrusted = '<img src=x onerror=alert(1) />';
    const contract = buildContract({
      models: {
        [untrusted]: {
          storage: { table: 'users' },
          fields: {
            [untrusted]: { column: untrusted },
          },
        },
      },
      mappings: {
        modelToTable: { [untrusted]: 'users' },
        tableToModel: { users: untrusted },
        fieldToColumn: { [untrusted]: { [untrusted]: untrusted } },
        columnToField: { users: { [untrusted]: untrusted } },
      },
    } as unknown as Partial<Contract>);

    const { container } = render(<ContractView contract={contract} />);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(untrusted)).toBeDefined();
  });
});
