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

interface Contract {
  coreHash: string;
  profileHash: string;
  target: string;
  storage: { tables: Record<string, Table> };
  capabilities: Record<string, Record<string, boolean>>;
  extensionPacks: Record<string, unknown>;
}

function renderContract(c: Contract): string {
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
      <span class="hash-label">Core Hash:</span>
      <span class="hash-value">${c.coreHash}</span>
    </div>
    <div class="hash">
      <span class="hash-label">Profile Hash:</span>
      <span class="hash-value">${c.profileHash}</span>
    </div>
    <div class="section">
      <div class="section-title">Target: ${c.target}</div>
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
    if (app && newContract?.default) {
      app.innerHTML = renderContract(newContract.default as Contract);
    }
  });
}
