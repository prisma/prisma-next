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
import { type ContractIR, renderContractInto } from './contract-view';
import type { Contract } from './prisma/contract.d';
import contractJson from './prisma/contract.json' with { type: 'json' };

function renderFromContractJson(json: unknown): void {
  const c = validateContract<Contract>(json) as unknown as ContractIR;
  if (app) renderContractInto(app, c);
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
