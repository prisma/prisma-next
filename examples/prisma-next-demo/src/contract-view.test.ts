import { describe, expect, it } from 'vitest';
import { renderContractInto } from './contract-view';
import type { Contract } from './prisma/contract.d';

class FakeElement {
  readonly tagName: string;
  className = '';
  textContent: string | null = null;
  readonly children: FakeElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...nodes);
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

function collectByClassName(root: FakeElement, className: string): FakeElement[] {
  const matches: FakeElement[] = [];
  if (root.className === className) {
    matches.push(root);
  }

  for (const child of root.children) {
    matches.push(...collectByClassName(child, className));
  }

  return matches;
}

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

describe('renderContractInto', () => {
  it('renders expected section headings and badges', () => {
    const app = new FakeElement('div');
    const doc = new FakeDocument();
    const contract = buildContract();

    renderContractInto(app as unknown as Element, contract, doc as unknown as Document);

    const titles = collectByClassName(app, 'section-title').map((el) => el.textContent);
    expect(titles).toEqual(['Target: postgres', 'Models', 'Tables', 'Capabilities', 'Extensions']);

    const badges = collectByClassName(app, 'cap-badge').map((el) => el.textContent);
    expect(badges).toContain('sql/returning');
    expect(badges).toContain('pgvector');
  });

  it('renders untrusted values as text content', () => {
    const app = new FakeElement('div');
    const doc = new FakeDocument();
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

    renderContractInto(app as unknown as Element, contract, doc as unknown as Document);

    const names = collectByClassName(app, 'col-name').map((el) => el.textContent);
    expect(names).toContain(untrusted);

    const types = collectByClassName(app, 'col-type').map((el) => el.textContent);
    expect(types).toContain(`→ ${untrusted}`);
  });
});
