import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../../../../');

const GENERATED_ARTIFACT_ROOTS = [
  'examples/prisma-next-demo/src/prisma/contract.d.ts',
  'examples/prisma-orm-demo/src/prisma-next/contract.d.ts',
  'test/e2e/framework/test/fixtures/generated/contract.d.ts',
] as const;

function assertNoLegacyMappingsInContract(content: string): void {
  const mappingsSection = content.replace(/\s+/g, ' ').match(/SqlContract\s*<\s*([^>]+)\s*>/);
  if (!mappingsSection) {
    throw new Error('Could not find SqlContract type in generated file');
  }
  const contractBody = mappingsSection[1];
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

describe('Generated contract.d.ts artifact shape (Task 5.1)', () => {
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
      });
    });
  }
});
