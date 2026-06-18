import { parse } from '@prisma-next/psl-parser/parser';
import { describe, expect, it } from 'vitest';
import { mapParseDiagnostics, ParseDiagnosticSeverity } from '../src/diagnostic-mapping';

describe('mapParseDiagnostics', () => {
  it('passes the parser range through unchanged', () => {
    const source = 'model {';
    const { diagnostics } = parse(source);
    expect(diagnostics.length).toBeGreaterThan(0);

    const mapped = mapParseDiagnostics(diagnostics);

    expect(mapped).toHaveLength(diagnostics.length);
    for (const [index, mappedDiagnostic] of mapped.entries()) {
      const source = diagnostics[index];
      expect(mappedDiagnostic.range).toEqual(source?.range);
      expect(mappedDiagnostic.message).toBe(source?.message);
      expect(mappedDiagnostic.code).toBe(source?.code);
      expect(mappedDiagnostic.severity).toBe(ParseDiagnosticSeverity.Error);
    }
  });

  it('returns an empty array for a clean parse', () => {
    const { diagnostics } = parse('model User {\n  id Int @id\n}\n');
    expect(diagnostics).toHaveLength(0);
    expect(mapParseDiagnostics(diagnostics)).toEqual([]);
  });
});
