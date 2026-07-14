import { readFile } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';
import { collectScalarTypeConstructors } from '@prisma-next/framework-components/authoring';
import { buildSymbolTable, rangeToPslSpan } from '@prisma-next/psl-parser';
import type { PslInterpretCapable } from '@prisma-next/psl-parser/interpret';
import { withSeedDiagnostics } from '@prisma-next/psl-parser/interpret';
import type { ParseDiagnostic, SourceFile } from '@prisma-next/psl-parser/syntax';
import { parse } from '@prisma-next/psl-parser/syntax';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk } from '@prisma-next/utils/result';

import { interpretPslDocumentToMongoContract } from './interpreter';

export interface MongoContractOptions {
  readonly output?: string;
  /** The target's default codec ids for an `enum` block that omits `@@type`. */
  readonly enumInferenceCodecs?: { readonly text: string; readonly int: string };
}

function collectScalarTypeCodecIds(namespace: AuthoringTypeNamespace): ReadonlyMap<string, string> {
  return new Map(
    [...collectScalarTypeConstructors(namespace)].map(([name, output]) => [name, output.codecId]),
  );
}

function mapParseDiagnostics(
  diagnostics: readonly ParseDiagnostic[],
  sourceFile: SourceFile,
  sourceId: string,
): ContractSourceDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    sourceId,
    span: rangeToPslSpan(diagnostic.range, sourceFile),
  }));
}

export function mongoContract(schemaPath: string, options?: MongoContractOptions): ContractConfig {
  const source: PslInterpretCapable = {
    sourceFormat: 'psl',
    inputs: [schemaPath],
    interpret(input, context) {
      return interpretPslDocumentToMongoContract({
        symbolTable: input.symbolTable,
        sourceFile: input.sourceFile,
        sourceId: input.sourceId,
        seedDiagnostics: [],
        scalarTypeCodecIds: collectScalarTypeCodecIds(context.authoringContributions.type),
        codecLookup: context.codecLookup,
        authoringContributions: context.authoringContributions,
        ...ifDefined('enumInferenceCodecs', options?.enumInferenceCodecs),
      });
    },
    async load(context) {
      const [absoluteSchemaPath] = context.resolvedInputs;
      if (absoluteSchemaPath === undefined) {
        throw new Error(
          'mongoContract: context.resolvedInputs is empty. The CLI config loader should populate it positional-matched with source.inputs.',
        );
      }
      let schema: string;
      try {
        schema = await readFile(absoluteSchemaPath, 'utf-8');
      } catch (error) {
        const message = String(error);
        return notOk({
          summary: `Failed to read Prisma schema at "${schemaPath}"`,
          diagnostics: [
            {
              code: 'PSL_SCHEMA_READ_FAILED',
              message,
              sourceId: schemaPath,
            },
          ],
          meta: { schemaPath, absoluteSchemaPath, cause: message },
        });
      }

      const scalarTypeCodecIds = collectScalarTypeCodecIds(context.authoringContributions.type);

      const { document, sourceFile, diagnostics: parseDiagnostics } = parse(schema);
      const { table: symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
        document,
        sourceFile,
        scalarTypes: [...scalarTypeCodecIds.keys()],
        pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
      });

      // Do not short-circuit on provider-level diagnostics; recovered CST can
      // still produce interpreter diagnostics in the same response.
      const seedDiagnostics = [
        ...mapParseDiagnostics(parseDiagnostics, sourceFile, schemaPath),
        ...mapParseDiagnostics(symbolTableDiagnostics, sourceFile, schemaPath),
      ];

      return withSeedDiagnostics(
        this.interpret({ document, sourceFile, symbolTable, sourceId: schemaPath }, context),
        seedDiagnostics,
      );
    },
  };

  return {
    source,
    ...ifDefined('output', options?.output),
  };
}
