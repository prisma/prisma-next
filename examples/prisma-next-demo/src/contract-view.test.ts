import { describe, expect, it } from 'vitest';
import type { ContractIR } from './contract-view';
import { renderContractInto } from './contract-view';

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

function buildContract(overrides?: Partial<ContractIR>): ContractIR {
  const base: ContractIR = {
    storageHash: 'storage_hash',
    target: 'postgres',
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
            id: { nativeType: 'uuid', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          foreignKeys: [],
        },
      },
    },
    relations: {
      users: {},
    },
    capabilities: {
      sql: { returning: true },
    },
    extensionPacks: {
      pgvector: {},
    },
  } as unknown as ContractIR;

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
    } as unknown as ContractIR['models']);

    renderContractInto(app as unknown as Element, contract, doc as unknown as Document);

    const names = collectByClassName(app, 'col-name').map((el) => el.textContent);
    expect(names).toContain(untrusted);

    const types = collectByClassName(app, 'col-type').map((el) => el.textContent);
    expect(types).toContain(`→ ${untrusted}`);
  });
});
