import type { ModelDefinition, SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';

type Relation = {
  readonly cardinality: string;
  readonly to: string;
  readonly on: { readonly parentCols: readonly string[]; readonly childCols: readonly string[] };
};

export type ContractIR = SqlContract<SqlStorage, Record<string, ModelDefinition>> & {
  target: string;
  relations: Record<string, Record<string, Relation>>;
  capabilities: Record<string, Record<string, boolean>>;
  extensionPacks: Record<string, unknown>;
};

function createElement(
  doc: Document,
  tagName: string,
  className?: string,
  text?: string,
): HTMLElement {
  const element = doc.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function appendFieldRow(doc: Document, parent: HTMLElement, name: string, column: string): void {
  const row = createElement(doc, 'div', 'column');
  row.append(createElement(doc, 'span', 'col-name', name));
  row.append(createElement(doc, 'span', 'col-type', `→ ${column}`));
  parent.append(row);
}

function appendRelationRow(
  doc: Document,
  parent: HTMLElement,
  name: string,
  relation: Relation,
): void {
  const row = createElement(doc, 'div', 'column');
  const arrow = relation.cardinality === '1:N' ? '⇉' : '→';
  row.append(createElement(doc, 'span', 'col-name', `${arrow} ${name}`));
  row.append(createElement(doc, 'span', 'col-type', `${relation.cardinality} → ${relation.to}`));
  parent.append(row);
}

function appendModelCard(
  doc: Document,
  parent: HTMLElement,
  modelName: string,
  model: ModelDefinition,
  c: ContractIR,
): void {
  const tableName = model.storage.table;
  const tableRelations = c.relations[tableName] ?? {};
  const card = createElement(doc, 'div', 'table-card');
  const header = createElement(doc, 'div', 'table-name');
  header.append(createElement(doc, 'span', undefined, `🧩 ${modelName}`));
  header.append(createElement(doc, 'span', 'pk-badge', `table: ${tableName}`));
  card.append(header);

  const columns = createElement(doc, 'div', 'columns');
  for (const [fieldName, field] of Object.entries(model.fields)) {
    appendFieldRow(doc, columns, fieldName, `${field?.column ?? ''}`);
  }

  const relationEntries = Object.entries(tableRelations);
  if (relationEntries.length > 0) {
    const relationGroup = createElement(doc, 'div', 'columns');
    for (const [relationName, relation] of relationEntries) {
      appendRelationRow(doc, relationGroup, relationName, relation);
    }
    columns.append(relationGroup);
  }

  card.append(columns);
  parent.append(card);
}

function appendTableCard(
  doc: Document,
  parent: HTMLElement,
  tableName: string,
  table: ContractIR['storage']['tables'][string],
): void {
  const primaryKey = table.primaryKey?.columns ?? [];
  const card = createElement(doc, 'div', 'table-card');
  const header = createElement(doc, 'div', 'table-name');
  header.append(createElement(doc, 'span', undefined, `📦 ${tableName}`));
  header.append(createElement(doc, 'span', 'pk-badge', `PK: ${primaryKey.join(', ')}`));
  card.append(header);

  const columns = createElement(doc, 'div', 'columns');
  for (const [columnName, column] of Object.entries(table.columns)) {
    const row = createElement(doc, 'div', 'column');
    const prefix = primaryKey.includes(columnName) ? '🔑 ' : '';
    row.append(createElement(doc, 'span', 'col-name', `${prefix}${columnName}`));
    row.append(createElement(doc, 'span', 'col-type', `${column.nativeType}`));
    if (column.nullable) {
      row.append(createElement(doc, 'span', 'col-nullable', 'nullable'));
    }
    columns.append(row);
  }

  for (const foreignKey of table.foreignKeys ?? []) {
    const row = createElement(doc, 'div', 'column');
    row.append(createElement(doc, 'span', 'col-name', `→ ${foreignKey.columns.join(', ')}`));
    row.append(
      createElement(
        doc,
        'span',
        'col-type',
        `→ ${foreignKey.references.table}(${foreignKey.references.columns.join(', ')})`,
      ),
    );
    columns.append(row);
  }

  card.append(columns);
  parent.append(card);
}

function appendSection(doc: Document, root: HTMLElement, title: string): HTMLElement {
  const section = createElement(doc, 'div', 'section');
  section.append(createElement(doc, 'div', 'section-title', title));
  root.append(section);
  return section;
}

export function renderContractInto(
  container: Element,
  c: ContractIR,
  doc: Document = document,
): void {
  const fragmentRoot = createElement(doc, 'div');

  const hash = createElement(doc, 'div', 'hash');
  hash.append(createElement(doc, 'span', 'hash-label', 'Storage Hash:'));
  hash.append(createElement(doc, 'span', 'hash-value', c.storageHash));
  fragmentRoot.append(hash);

  appendSection(doc, fragmentRoot, `Target: ${c.target}`);

  const modelsSection = appendSection(doc, fragmentRoot, 'Models');
  for (const [modelName, model] of Object.entries(c.models)) {
    appendModelCard(doc, modelsSection, modelName, model, c);
  }

  const tablesSection = appendSection(doc, fragmentRoot, 'Tables');
  for (const [tableName, table] of Object.entries(c.storage.tables)) {
    appendTableCard(doc, tablesSection, tableName, table);
  }

  const capabilitiesSection = appendSection(doc, fragmentRoot, 'Capabilities');
  const capabilities = createElement(doc, 'div', 'capabilities');
  const capabilityFlags = Object.entries(c.capabilities).flatMap(([namespace, flags]) =>
    Object.entries(flags)
      .filter(([, enabled]) => enabled)
      .map(([key]) => `${namespace}/${key}`),
  );
  if (capabilityFlags.length === 0) {
    capabilities.append(createElement(doc, 'span', 'col-type', 'None'));
  } else {
    for (const flag of capabilityFlags) {
      capabilities.append(createElement(doc, 'span', 'cap-badge', flag));
    }
  }
  capabilitiesSection.append(capabilities);

  const extensionsSection = appendSection(doc, fragmentRoot, 'Extensions');
  const extensions = createElement(doc, 'div', 'capabilities');
  const extensionNames = Object.keys(c.extensionPacks);
  if (extensionNames.length === 0) {
    extensions.append(createElement(doc, 'span', 'col-type', 'None'));
  } else {
    for (const extensionName of extensionNames) {
      extensions.append(createElement(doc, 'span', 'cap-badge', extensionName));
    }
  }
  extensionsSection.append(extensions);

  container.replaceChildren(fragmentRoot);
}
