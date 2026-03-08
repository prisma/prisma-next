import { validateContract } from '@prisma-next/sql-contract/validate';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' with { type: 'json' };
import { App } from './App';

function renderApp(json: unknown) {
  const contract = validateContract<Contract>(json);
  root.render(
    <StrictMode>
      <App contract={contract} />
    </StrictMode>,
  );
}

const el = document.getElementById('root');
if (!el) throw new Error('Missing #root element');
const root = createRoot(el);
renderApp(contractJson);

if (import.meta.hot) {
  import.meta.hot.accept('../prisma/contract.json', (mod) => {
    const data = mod ? (mod as unknown as Record<string, unknown>)['default'] : undefined;
    if (data !== undefined) renderApp(data);
  });
}
