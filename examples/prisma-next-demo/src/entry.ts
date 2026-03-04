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

import { type ContractIR, renderContractInto } from './contract-view';
import contractJson from './prisma/contract.json';

const app = document.getElementById('contract-view');
if (app) {
  renderContractInto(app, contractJson as unknown as ContractIR);
}

if (import.meta.hot) {
  import.meta.hot.accept('./prisma/contract.json', (newContract) => {
    if (app && newContract) {
      renderContractInto(app, newContract as unknown as ContractIR);
    }
  });
}
