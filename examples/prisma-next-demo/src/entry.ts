/**
 * Browser Application Entry Point (Contract Visualization)
 *
 * Renders the constructed Contract directly from the runtime value.
 * Demonstrates: validate contract first, render from constructed Contract,
 * HMR with re-emit for live updates.
 *
 * Spec: agent-os/specs/2026-02-15-runtime-dx-ir-shaped-contract-mappings-on-executioncontext/spec.md
 *
 * Run with: pnpm dev (starts Vite dev server with HMR)
 */
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { Contract } from './prisma/contract.d';
import contractJson from './prisma/contract.json' with { type: 'json' };

type RelationView = { readonly cardinality: string; readonly to: string };

function renderContract(c: Contract): string {
  const relationsByTable = c.relations as Record<string, Record<string, RelationView>>;
  const models = Object.entries(c.models)
    .map(([name, model]) => {
      const tableName = model.storage.table;
      const tableRelations = relationsByTable[tableName] ?? {};
      const fieldToColumn = c.mappings.fieldToColumn?.[tableName] ?? {};

      const fields = Object.keys(model.fields)
        .map((fieldName) => {
          const col = fieldToColumn[fieldName] ?? fieldName;
          return `
            <div class="column">
              <span class="col-name">${fieldName}</span>
              <span class="col-type">→ ${col}</span>
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
      const pk = (table.primaryKey?.columns ?? []) as readonly string[];
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
      <span class="hash-label">Storage Hash:</span>
      <span class="hash-value">${c.storageHash}</span>
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

function renderFromContractJson(json: unknown): void {
  const c = validateContract<Contract>(json);
  if (app) app.innerHTML = renderContract(c);
}

const app = document.getElementById('contract-view');
if (app) {
  renderFromContractJson(contractJson);
}

if (import.meta.hot) {
  import.meta.hot.accept('./prisma/contract.json', (mod) => {
    const data = mod ? (mod as unknown as Record<string, unknown>)['default'] : undefined;
    if (data !== undefined) renderFromContractJson(data);
  });
}
