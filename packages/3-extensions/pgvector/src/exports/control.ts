import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionPackManifest } from '@prisma-next/contract/pack-manifest-types';
import type { SchemaIssue } from '@prisma-next/core-control-plane/types';
import type {
  ComponentDatabaseDependencies,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { type } from 'arktype';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TypesImportSpecSchema = type({
  package: 'string',
  named: 'string',
  alias: 'string',
});

const ExtensionPackManifestSchema = type({
  id: 'string',
  version: 'string',
  'targets?': type({ '[string]': type({ 'minVersion?': 'string' }) }),
  'capabilities?': 'Record<string, unknown>',
  'types?': type({
    'codecTypes?': type({
      import: TypesImportSpecSchema,
    }),
    'operationTypes?': type({
      import: TypesImportSpecSchema,
    }),
  }),
  'operations?': 'unknown[]',
});

/**
 * Loads the extension pack manifest from packs/manifest.json.
 */
function loadExtensionManifest(): ExtensionPackManifest {
  const manifestPath = join(__dirname, '../../packs/manifest.json');
  const manifestJson = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const result = ExtensionPackManifestSchema(manifestJson);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid extension manifest structure at ${manifestPath}: ${messages}`);
  }

  return result as ExtensionPackManifest;
}

/**
 * Pure verification hook: checks whether the 'vector' extension is installed
 * based on the in-memory schema IR (no DB I/O).
 */
function verifyVectorExtensionInstalled(schema: SqlSchemaIR): readonly SchemaIssue[] {
  if (!schema.extensions.includes('vector')) {
    return [
      {
        kind: 'extension_missing',
        table: '',
        message: 'Extension "vector" is missing from database (required by pgvector)',
      },
    ];
  }
  return [];
}

/**
 * Database dependencies for the pgvector extension.
 * Declares the 'vector' Postgres extension as a required dependency.
 */
const pgvectorDatabaseDependencies: ComponentDatabaseDependencies<unknown> = {
  init: [
    {
      id: 'postgres.extension.vector',
      label: 'Enable vector extension',
      install: [
        {
          id: 'extension.vector',
          label: 'Enable extension "vector"',
          summary: 'Ensures the vector extension is available for pgvector operations',
          operationClass: 'additive',
          target: { id: 'postgres' },
          precheck: [
            {
              description: 'verify extension "vector" is not already enabled',
              sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
            },
          ],
          execute: [
            {
              description: 'create extension "vector"',
              sql: 'CREATE EXTENSION IF NOT EXISTS vector',
            },
          ],
          postcheck: [
            {
              description: 'confirm extension "vector" is enabled',
              sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
            },
          ],
        },
      ],
      verifyDatabaseDependenciesInstalled: verifyVectorExtensionInstalled,
    },
  ],
};

/**
 * pgvector extension descriptor for CLI config.
 * Declares database dependencies for the 'vector' Postgres extension.
 */
const pgvectorExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  familyId: 'sql',
  targetId: 'postgres', // pgvector is postgres-specific
  id: 'pgvector',
  manifest: loadExtensionManifest(),
  databaseDependencies: pgvectorDatabaseDependencies,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export default pgvectorExtensionDescriptor;
