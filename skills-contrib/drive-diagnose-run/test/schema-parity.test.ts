import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const CANONICAL_PATH = fileURLToPath(
  new URL('../../drive-record-traces/schema.ts', import.meta.url),
);
const VENDORED_PATH = fileURLToPath(new URL('../schema.ts', import.meta.url));

function schemaRegion(filePath: string): string {
  const text = readFileSync(filePath, 'utf8');
  return text.split('\n').slice(1).join('\n');
}

describe('schema parity', () => {
  it('drive-diagnose-run/schema.ts schema region is byte-identical to drive-record-traces/schema.ts', () => {
    const canonical = schemaRegion(CANONICAL_PATH);
    const vendored = schemaRegion(VENDORED_PATH);
    assert.equal(
      vendored,
      canonical,
      'Vendored drive-diagnose-run/schema.ts has drifted from canonical drive-record-traces/schema.ts. ' +
        'Update the vendored copy to match the canonical file (first-line banner is excluded from the check).',
    );
  });
});
