import contract from './prisma/contract.json';

interface Column {
  codecId: string;
  nativeType: string;
  nullable?: boolean;
}

interface Table {
  columns: Record<string, Column>;
  primaryKey?: { columns: string[] };
  foreignKeys?: Array<{
    columns: string[];
    name: string;
    references: { table: string; columns: string[] };
  }>;
}

interface Model {
  fields: Record<string, { column: string }>;
  relations: Record<string, unknown>;
  storage: { table: string };
}

interface Relation {
  cardinality: string;
  to: string;
  on: { parentCols: string[]; childCols: string[] };
}

interface Contract {
  coreHash: string;
  profileHash: string;
  target: string;
  models: Record<string, Model>;
  storage: { tables: Record<string, Table> };
  relations: Record<string, Record<string, Relation>>;
  capabilities: Record<string, Record<string, boolean>>;
  extensionPacks: Record<string, unknown>;
}

function renderContract(c: Contract): string {
  const models = Object.entries(c.models)
    .map(([name, model]) => {
      const tableName = model.storage.table;
      const tableRelations = c.relations[tableName] ?? {};

      const fields = Object.entries(model.fields)
        .map(([fieldName, field]) => {
          return `
            <div class="column">
              <span class="col-name">${fieldName}</span>
              <span class="col-type">→ ${field.column}</span>
            </div>
          `;
        })
        .join('');

      const relations = Object.entries(tableRelations)
        .map(([relName, rel]) => {
          const arrow = rel.cardinality === '1:N' ? '⇉' : '→';
          return `
            <div class="column">
              <span class="col-name">${arrow} ${relName}</span>
              <span class="col-type">${rel.cardinality} → ${rel.to}</span>
            </div>
          `;
        })
        .join('');

      return `
        <div class="table-card">
          <div class="table-name">
            🧩 ${name}
            <span class="pk-badge">table: ${tableName}</span>
          </div>
          <div class="columns">
            ${fields}
            ${relations ? `<div style="border-top: 1px solid var(--border); margin: 0.5rem 0; padding-top: 0.5rem;">${relations}</div>` : ''}
          </div>
        </div>
      `;
    })
    .join('');

  const tables = Object.entries(c.storage.tables)
    .map(([name, table]) => {
      const pk = table.primaryKey?.columns ?? [];
      const columns = Object.entries(table.columns)
        .map(([colName, col]) => {
          const isPk = pk.includes(colName);
          const nullable = col.nullable ? '<span class="col-nullable">nullable</span>' : '';
          return `
            <div class="column">
              <span class="col-name">${isPk ? '🔑 ' : ''}${colName}</span>
              <span class="col-type">${col.nativeType}</span>
              ${nullable}
            </div>
          `;
        })
        .join('');

      const fks = (table.foreignKeys ?? [])
        .map(
          (fk) =>
            `<div class="column"><span class="col-name">→ ${fk.columns.join(', ')}</span><span class="col-type">→ ${fk.references.table}(${fk.references.columns.join(', ')})</span></div>`,
        )
        .join('');

      return `
        <div class="table-card">
          <div class="table-name">
            📦 ${name}
            <span class="pk-badge">PK: ${pk.join(', ')}</span>
          </div>
          <div class="columns">${columns}${fks}</div>
        </div>
      `;
    })
    .join('');

  const caps = Object.entries(c.capabilities)
    .flatMap(([ns, flags]) =>
      Object.entries(flags)
        .filter(([, v]) => v)
        .map(([k]) => `<span class="cap-badge">${ns}/${k}</span>`),
    )
    .join('');

  const extensions = Object.keys(c.extensionPacks)
    .map((ext) => `<span class="cap-badge">${ext}</span>`)
    .join('');

  return `
    <div class="hash">
      <span class="hash-label">Contract Hash:</span>
      <span class="hash-value">${c.coreHash}</span>
    </div>
    <div class="section">
      <div class="section-title">Target: ${c.target}</div>
    </div>
    <div class="section">
      <div class="section-title">Models</div>
      ${models}
    </div>
    <div class="section">
      <div class="section-title">Tables</div>
      ${tables}
    </div>
    <div class="section">
      <div class="section-title">Capabilities</div>
      <div class="capabilities">${caps || '<span class="col-type">None</span>'}</div>
    </div>
    <div class="section">
      <div class="section-title">Extensions</div>
      <div class="capabilities">${extensions || '<span class="col-type">None</span>'}</div>
    </div>
  `;
}

const app = document.getElementById('contract-view');
if (app) {
  app.innerHTML = renderContract(contract as unknown as Contract);
}

if (import.meta.hot) {
  import.meta.hot.accept('./prisma/contract.json', (newContract) => {
    if (app && newContract) {
      const mod = newContract as unknown as { default: unknown };
      app.innerHTML = renderContract(mod.default as Contract);
    }
  });
}
