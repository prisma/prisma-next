import { pathToFileURL } from 'node:url';
import { parse } from '@prisma-next/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import { computeDocumentDiagnostics } from '../src/document-diagnostics';
import { resolveSchemaInputs } from '../src/schema-inputs';

const schemaUri = pathToFileURL('/abs/schema.psl').toString();
const inputs = resolveSchemaInputs({
  contract: { source: { sourceFormat: 'psl', inputs: ['/abs/schema.psl'] } },
});

describe('computeDocumentDiagnostics', () => {
  it('publishes parser diagnostics for a configured PSL input with a parse error', () => {
    const source = 'model {';
    const result = computeDocumentDiagnostics(schemaUri, source, inputs);
    expect(result).not.toBeNull();
    expect(result).toEqual(mapParseDiagnostics(parse(source).diagnostics));
    expect(result?.length).toBeGreaterThan(0);
  });

  it('publishes an empty array for a clean configured PSL input', () => {
    const result = computeDocumentDiagnostics(schemaUri, 'model User {\n  id Int @id\n}\n', inputs);
    expect(result).toEqual([]);
  });

  it('returns null for a document that is not a configured input', () => {
    const otherUri = pathToFileURL('/abs/not-a-schema.psl').toString();
    const result = computeDocumentDiagnostics(otherUri, 'model {', inputs);
    expect(result).toBeNull();
  });
});
