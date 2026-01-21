/**
 * Browser Application Entry Point (Contract Visualization)
 *
 * This is a Vite-powered browser application that renders the emitted
 * contract.json as an interactive HTML visualization. It demonstrates:
 *
 * - Machine-readable contracts: The JSON structure can be consumed by tools
 * - Hot Module Replacement: Edit contract.ts, re-emit, and watch it update live
 * - Contract introspection: Models, tables, relations, capabilities, extensions
 *
 * Run with: pnpm dev (starts Vite dev server with HMR)
 *
 * See also:
 * - main.ts: CLI app using the same emitted contract
 * - main-no-emit.ts: CLI app using inline contract definition
 */
import type { ModelDefinition, SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import contractJson from './prisma/contract.json';

type Relation = {
  readonly cardinality: string;
  readonly to: string;
  readonly on: { readonly parentCols: readonly string[]; readonly childCols: readonly string[] };
};

// Temporary demo-only shim: today the validated Contract type doesn't fully reflect the
// traversable IR shape we visualize here (target/relations/capabilities/extensionPacks).
// TML-1831 will make this redundant by aligning Contract with validateContract() output and
// moving derived mappings onto ExecutionContext:
// https://linear.app/prisma-company/issue/TML-1831/runtime-dx-ir-shaped-contract-mappings-on-executioncontext
type ContractIR = SqlContract<SqlStorage, Record<string, ModelDefinition>> & {
  target: string;
  relations: Record<string, Record<string, Relation>>;
  capabilities: Record<string, Record<string, boolean>>;
  extensionPacks: Record<string, unknown>;
};

function renderContract(c: ContractIR): string {
  const models = Object.entries(c.models)
    .map(([name, model]) => {
      const tableName = model.storage.table;
      const tableRelations = c.relations[tableName] ?? {};

      const fields = Object.entries(model.fields)
        .map(([fieldName, field]) => {
          return `
            <div class="column">
              <span class="col-name">${fieldName}</span>
              <span class="col-type">→ ${field?.column}</span>
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
  app.innerHTML = renderContract(contractJson as unknown as ContractIR);
}

if (import.meta.hot) {
  import.meta.hot.accept('./prisma/contract.json', (newContract) => {
    if (app && newContract) {
      app.innerHTML = renderContract(newContract as unknown as ContractIR);
    }
  });
}
