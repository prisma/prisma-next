import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../../../');

const GENERATED_ARTIFACT_ROOTS = [
  'examples/prisma-next-demo/src/prisma/contract.d.ts',
  'test/e2e/framework/test/fixtures/generated/contract.d.ts',
] as const;

function extractSqlContractBody(content: string): string {
  const flat = content.replace(/\s+/g, ' ');
  const marker = flat.indexOf('SqlContract');
  if (marker === -1) throw new Error('Could not find SqlContract type in generated file');
  const openIdx = flat.indexOf('<', marker);
  if (openIdx === -1) throw new Error('Could not find SqlContract type in generated file');
  let depth = 1;
  let i = openIdx + 1;
  while (i < flat.length && depth > 0) {
    if (flat[i] === '<') depth++;
    else if (flat[i] === '>') depth--;
    i++;
  }
  if (depth !== 0) throw new Error('Unbalanced angle brackets in SqlContract type');
  return flat.slice(openIdx + 1, i - 1);
}

function assertNoLegacyMappingsInContract(content: string): void {
  const contractBody = extractSqlContractBody(content);
  const legacyCodecInMappings = /columnToField[^}]+}\s*}\s*,\s*codecTypes\s*:/;
  const legacyOpInMappings = /columnToField[^}]+}\s*}\s*,\s*operationTypes\s*:/;
  if (legacyCodecInMappings.test(contractBody)) {
    throw new Error('Contract mappings must not include codecTypes (use separate TypeMaps export)');
  }
  if (legacyOpInMappings.test(contractBody)) {
    throw new Error(
      'Contract mappings must not include operationTypes (use separate TypeMaps export)',
    );
  }
}

describe('Generated contract.d.ts artifact shape', () => {
  for (const artifactPath of GENERATED_ARTIFACT_ROOTS) {
    const absolutePath = join(REPO_ROOT, artifactPath);
    describe(artifactPath, () => {
      it('exports separate TypeMaps', () => {
        const content = readFileSync(absolutePath, 'utf-8');
        expect(content).toMatch(/export type TypeMaps\s*=/);
      });

      it('does not declare legacy mappings.codecTypes or mappings.operationTypes', () => {
        const content = readFileSync(absolutePath, 'utf-8');
        expect(() => assertNoLegacyMappingsInContract(content)).not.toThrow();
      });

      it('mappings type includes only runtime-real keys', () => {
        const content = readFileSync(absolutePath, 'utf-8');
        const hasLegacyCodecInMappings = /\bcodecTypes:\s*(PgTypes|PgVectorTypes|Record)/.test(
          content,
        );
        const hasLegacyOpInMappings = /\boperationTypes:\s*Record<string,\s*never>/.test(content);
        if (hasLegacyCodecInMappings || hasLegacyOpInMappings) {
          const legacy = [];
          if (hasLegacyCodecInMappings) legacy.push('codecTypes in mappings');
          if (hasLegacyOpInMappings) legacy.push('operationTypes in mappings');
          throw new Error(
            `Legacy shape detected: ${legacy.join(', ')}. Mappings must only include modelToTable, tableToModel, fieldToColumn, columnToField.`,
          );
        }

        for (const key of ['modelToTable', 'tableToModel', 'fieldToColumn', 'columnToField']) {
          expect(content).toContain(key);
        }
      });
    });
  }
});
