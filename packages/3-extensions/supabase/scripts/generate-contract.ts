#!/usr/bin/env node
/**
 * Regenerates `src/contract/contract.prisma` from a live (or hermetically
 * restored) Supabase-shaped database, then re-emits `contract.json` /
 * `contract.d.ts` via the pack's own `build:contract-space` script.
 *
 * By default spins up a fresh PGlite dev database and restores the checked-in
 * reference fixture (`test/fixtures/supabase-reference/`) — hermetic,
 * CI-runnable, no Docker. Pass `--url <connection-string>` to introspect a
 * live database instead (e.g. to refresh the fixture against a newer
 * Supabase release).
 *
 * Usage:
 *   pnpm --filter @prisma-next/extension-supabase run contract:generate
 *   pnpm --filter @prisma-next/extension-supabase run contract:generate -- --url postgres://...
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor from '@prisma-next/family-sql/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  namespacePslExtensionBlocks,
  type PslDocumentAst,
  type PslExtensionBlock,
  type PslModel,
  type PslNamedTypeDeclaration,
  type PslNamespace,
} from '@prisma-next/framework-components/psl-ast';
import { printPsl } from '@prisma-next/psl-printer';
import postgresTargetDescriptor from '@prisma-next/target-postgres/control';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresTableSchemaNode,
} from '@prisma-next/target-postgres/types';
import { createDevDatabase } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { SupabaseRole } from '../src/contract/roles';
import { restoreSupabaseReference } from '../test/fixtures/supabase-reference/restore';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// --- CLI flags ----------------------------------------------------------

function readUrlFlag(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--url');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value) throw new Error('generate-contract: --url requires a value');
  return value;
}

const explicitUrl = readUrlFlag(process.argv.slice(2));

// --- Column omissions (declarative, table.column keyed) -----------------
//
// Fidelity notes:
//   - storage.buckets.allowed_mime_types, storage.objects.path_tokens: both
//     nullable `text[]`. PSL/Prisma-family list fields have no nullable-list
//     syntax (`String[]?` is invalid), so a nullable array column has no
//     authorable PSL form; the interpreter's `list` and `optional` are
//     independent booleans, but the target's list-field lowering requires
//     `nullable: false`. `path_tokens` is additionally a `GENERATED ALWAYS`
//     column, so it is not user-writable either way. Omitted until nullable
//     list fields land; under `external` control an undeclared live column
//     is a suppressed extra, so omission is verify-safe.
const COLUMN_OMISSIONS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  storage: {
    buckets: ['allowed_mime_types'],
    objects: ['path_tokens'],
  },
};

// --- Default omissions (declarative, table.column keyed) ----------------
//
// Fidelity notes:
//   - auth.users.phone: `DEFAULT NULL` on a nullable column is a no-op (same
//     as no default at all), but the raw-default parser round-trips it as an
//     explicit `@default(null)`, which the interpreter rejects
//     (PSL_INVALID_DEFAULT_VALUE — "null" is not a value literal). Dropping
//     the default changes nothing observable: the column is still nullable
//     and still has no enforced default.
//   - auth.custom_oauth_providers.acceptable_client_ids / .scopes:
//     `DEFAULT '{}'::text[]` maps to a raw `dbgenerated(...)` default, and
//     the interpreter has no per-element execution-default semantics for
//     list fields (PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED). The column type
//     (`String[]`) is fully representable; only the default is omitted.
//   - auth.custom_oauth_providers.attribute_mapping / .authorization_params,
//     auth.webauthn_credentials.transports, storage.iceberg_namespaces.metadata:
//     `DEFAULT '{}'::jsonb` / `'[]'::jsonb` prints as
//     `@default(dbgenerated("'{}'::jsonb"))` — the PSL interpreter keeps a
//     `dbgenerated(...)` default as a `{ kind: 'function' }` resolved
//     default verbatim, while live introspection recognizes the same
//     `'{}'::jsonb ` raw default as a parseable JSON literal and resolves it
//     to `{ kind: 'literal', value: {} }` — same runtime behaviour, different
//     resolved shape, so `db verify` reports every such column as
//     `not-equal`. Omitted until the two sides agree on how a JSON literal
//     default resolves either way; the column type (`Json`) is unaffected.
const DEFAULT_OMISSIONS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  auth: {
    users: ['phone'],
    custom_oauth_providers: [
      'acceptable_client_ids',
      'scopes',
      'attribute_mapping',
      'authorization_params',
    ],
    webauthn_credentials: ['transports'],
  },
  storage: {
    iceberg_namespaces: ['metadata'],
  },
};

// --- Index omissions (declarative, index-name keyed) ---------------------
//
// Fidelity notes:
//   - auth.one_time_tokens_relates_to_hash_idx / _token_hash_hash_idx: both
//     `USING hash` indexes. The inferrer now carries a non-default index
//     access method through as `@@index(..., type: "hash")`, but `hash` is
//     not a registered index type on this pack's stack (`IndexTypeRegistry`
//     — see `packages/2-sql/1-core/contract/src/index-types.ts` — is an
//     opt-in extensibility point a target or extension pack populates, e.g.
//     `paradedbIndexTypes` for `bm25`; the postgres target itself registers
//     none). `contract emit` rejects an unregistered type, so these two
//     indexes are omitted rather than declared. Under `external` control an
//     undeclared live index is a suppressed extra, so omission is
//     verify-safe. Registering `hash` as a built-in postgres index type
//     would let both come back declared; out of scope here.
// This mechanism also serves as the escape hatch for whatever the *next*
// unrepresentable index turns out to be, following the same declarative
// pattern as the column/default omissions above.
const INDEX_OMISSIONS: Readonly<Record<string, readonly string[]>> = {
  auth: ['one_time_tokens_relates_to_hash_idx', 'one_time_tokens_token_hash_hash_idx'],
};

/**
 * PSL attribute argument values arrive as raw source text; a string-typed
 * argument (e.g. `@@map("users")`) is a JSON string literal, so JSON.parse
 * decodes it. Narrows instead of casting: a non-string here means the
 * argument wasn't a string literal, which is a malformed input worth failing
 * loudly on rather than silently propagating.
 */
function parseJsonStringLiteral(raw: string): string {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'string') {
    throw new Error(
      `generate-contract: expected a JSON string literal in a PSL attribute argument, got: ${raw}`,
    );
  }
  return value;
}

function indexOmissionNameOf(attribute: PslModel['attributes'][number]): string | undefined {
  const mapArg = attribute.args.find((arg) => arg.kind === 'named' && arg.name === 'map');
  if (!mapArg) return undefined;
  return parseJsonStringLiteral(mapArg.value);
}

/** Drops `@@index`/`@@unique` model attributes named in `omittedNames`. */
function applyIndexOmissions(
  namespace: PslNamespace,
  omittedNames: readonly string[],
): PslNamespace {
  if (omittedNames.length === 0) return namespace;
  let changed = false;
  const models = namespace.models.map((model) => {
    const attributes = model.attributes.filter((attribute) => {
      if (
        attribute.target !== 'model' ||
        (attribute.name !== 'index' && attribute.name !== 'unique')
      ) {
        return true;
      }
      const name = indexOmissionNameOf(attribute);
      const omit = name !== undefined && omittedNames.includes(name);
      if (omit) changed = true;
      return !omit;
    });
    return attributes.length === model.attributes.length ? model : { ...model, attributes };
  });

  if (!changed) return namespace;

  return makePslNamespace({
    kind: 'namespace',
    name: namespace.name,
    entries: makePslNamespaceEntries(
      models,
      namespace.compositeTypes,
      namespacePslExtensionBlocks(namespace),
    ),
    span: namespace.span,
  });
}

// --- Model renames (legacy names referenced by examples + cross-space FKs) -

const MODEL_RENAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  auth: {
    users: 'AuthUser',
    identities: 'AuthIdentity',
    sessions: 'AuthSession',
  },
  storage: {
    buckets: 'StorageBucket',
    objects: 'StorageObject',
  },
};

function omitColumns(
  tree: PostgresDatabaseSchemaNode,
  schemaName: string,
): PostgresDatabaseSchemaNode {
  const omissions = COLUMN_OMISSIONS[schemaName];
  if (!omissions) return tree;

  const namespace = tree.namespaces[schemaName];
  if (!namespace) return tree;

  let tables = namespace.tables;
  for (const [tableName, columns] of Object.entries(omissions)) {
    const table = tables[tableName];
    if (!table) continue;
    const remainingColumns = Object.fromEntries(
      Object.entries(table.columns).filter(([columnName]) => !columns.includes(columnName)),
    );
    tables = {
      ...tables,
      [tableName]: new PostgresTableSchemaNode({ ...table, columns: remainingColumns }),
    };
  }

  return new PostgresDatabaseSchemaNode({
    ...tree,
    namespaces: {
      ...tree.namespaces,
      [schemaName]: new PostgresNamespaceSchemaNode({ ...namespace, tables }),
    },
  });
}

function tableNameOfModel(model: PslModel): string {
  const mapAttribute = model.attributes.find(
    (attribute) => attribute.target === 'model' && attribute.name === 'map',
  );
  const arg = mapAttribute?.args[0];
  if (arg && arg.kind === 'positional') {
    return parseJsonStringLiteral(arg.value);
  }
  return model.name;
}

function columnNameOfField(field: PslModel['fields'][number]): string {
  const mapAttribute = field.attributes.find(
    (attribute) => attribute.target === 'field' && attribute.name === 'map',
  );
  const arg = mapAttribute?.args[0];
  if (arg && arg.kind === 'positional') {
    return parseJsonStringLiteral(arg.value);
  }
  return field.name;
}

/** Strips `@default(...)` from the fields named in `omissions`, keyed by backing table name. */
function applyDefaultOmissions(
  namespace: PslNamespace,
  omissions: Readonly<Record<string, readonly string[]>>,
): PslNamespace {
  let changed = false;
  const models = namespace.models.map((model) => {
    const columns = omissions[tableNameOfModel(model)];
    if (!columns) return model;
    const fields = model.fields.map((field) => {
      if (!columns.includes(columnNameOfField(field))) return field;
      const attributes = field.attributes.filter((attribute) => attribute.name !== 'default');
      if (attributes.length === field.attributes.length) return field;
      changed = true;
      return { ...field, attributes };
    });
    return { ...model, fields };
  });

  if (!changed) return namespace;

  return makePslNamespace({
    kind: 'namespace',
    name: namespace.name,
    entries: makePslNamespaceEntries(
      models,
      namespace.compositeTypes,
      namespacePslExtensionBlocks(namespace),
    ),
    span: namespace.span,
  });
}

function rlsModelAttribute(): PslModel['attributes'][number] {
  return { kind: 'attribute', target: 'model', name: 'rls', args: [], span: SYNTHETIC_SPAN };
}

/**
 * Marks every model backed by an RLS-enabled table with `@@rls` — an
 * argument-less model attribute (no policies authored) that only records
 * `ENABLE ROW LEVEL SECURITY`, matching what `db verify` observes live.
 * Every `auth`/`storage` table in a real Supabase instance has RLS enabled;
 * without this a verify comparison sees the contract's implicit
 * `rlsEnabled: false` against the live `true` and reports every such table
 * `not-equal`. Real Supabase policies are not captured — authoring the
 * policy set itself is out of scope here (see the RLS unification project).
 */
function applyRlsEnablement(
  namespace: PslNamespace,
  rlsEnabledTables: ReadonlySet<string>,
): PslNamespace {
  let changed = false;
  const models = namespace.models.map((model) => {
    if (!rlsEnabledTables.has(tableNameOfModel(model))) return model;
    changed = true;
    return { ...model, attributes: [...model.attributes, rlsModelAttribute()] };
  });
  if (!changed) return namespace;
  return makePslNamespace({
    kind: 'namespace',
    name: namespace.name,
    entries: makePslNamespaceEntries(
      models,
      namespace.compositeTypes,
      namespacePslExtensionBlocks(namespace),
    ),
    span: namespace.span,
  });
}

function mapModelAttribute(tableName: string): PslModel['attributes'][number] {
  return {
    kind: 'attribute',
    target: 'model',
    name: 'map',
    args: [
      {
        kind: 'positional',
        value: JSON.stringify(tableName),
        span: SYNTHETIC_SPAN,
      },
    ],
    span: SYNTHETIC_SPAN,
  };
}

const SYNTHETIC_SPAN = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function roleExtensionBlock(name: string): PslExtensionBlock {
  return {
    kind: 'role',
    keyword: 'role',
    name,
    parameters: {},
    blockAttributes: [],
    span: SYNTHETIC_SPAN,
  };
}

/**
 * Roles are cluster-scoped in Postgres: the `role` block factory stamps the
 * unbound coordinate on every lowered entity, so the blocks must be declared
 * inside an explicit `namespace unbound { … }` block, not in `auth` or
 * `storage`. `resolveNamespaceIdForSqlTarget` maps the `unbound` bucket name
 * to the framework's `__unbound__` sentinel.
 */
function roleNamespace(): PslNamespace {
  return makePslNamespace({
    kind: 'namespace',
    name: 'unbound',
    entries: makePslNamespaceEntries([], [], SupabaseRole.values.map(roleExtensionBlock)),
    span: SYNTHETIC_SPAN,
  });
}

/**
 * Renames the models this namespace declares whose backing table is in
 * `renames`. Returns the namespace with names/`@@map` updated, plus the
 * old-name -> new-name map for that namespace's own renames — callers apply
 * it (merged with every other namespace's map and the named-type
 * canonicalization map below) in one global field-`typeName` rewrite pass,
 * since a relation can point at a model in a namespace processed earlier or
 * later in namespace-array order.
 */
function renameModels(
  namespace: PslNamespace,
  renames: Readonly<Record<string, string>>,
): { readonly namespace: PslNamespace; readonly renameMap: ReadonlyMap<string, string> } {
  const renameMap = new Map<string, string>();
  const models = namespace.models.map((model) => {
    const tableName = tableNameOfModel(model);
    const newName = renames[tableName];
    if (!newName || newName === model.name) return model;
    renameMap.set(model.name, newName);
    const hasMapAttribute = model.attributes.some(
      (attribute) => attribute.target === 'model' && attribute.name === 'map',
    );
    return {
      ...model,
      name: newName,
      attributes: hasMapAttribute
        ? model.attributes
        : [...model.attributes, mapModelAttribute(tableName)],
    };
  });

  if (renameMap.size === 0) return { namespace, renameMap };

  return {
    namespace: makePslNamespace({
      kind: 'namespace',
      name: namespace.name,
      entries: makePslNamespaceEntries(
        models,
        namespace.compositeTypes,
        namespacePslExtensionBlocks(namespace),
      ),
      span: namespace.span,
    }),
    renameMap,
  };
}

/** Rewrites every field's `typeName` across the whole namespace via `renameMap`. */
function rewriteFieldTypeNames(
  namespace: PslNamespace,
  renameMap: ReadonlyMap<string, string>,
): PslNamespace {
  if (renameMap.size === 0) return namespace;
  let changed = false;
  const models = namespace.models.map((model) => {
    const fields = model.fields.map((field) => {
      const newTypeName = renameMap.get(field.typeName);
      if (newTypeName === undefined) return field;
      changed = true;
      return { ...field, typeName: newTypeName };
    });
    return { ...model, fields };
  });
  if (!changed) return namespace;
  return makePslNamespace({
    kind: 'namespace',
    name: namespace.name,
    entries: makePslNamespaceEntries(
      models,
      namespace.compositeTypes,
      namespacePslExtensionBlocks(namespace),
    ),
    span: namespace.span,
  });
}

function namedTypeSignature(declaration: PslNamedTypeDeclaration): string {
  return JSON.stringify({
    baseType: declaration.baseType,
    typeConstructor: declaration.typeConstructor,
    attributes: declaration.attributes,
  });
}

/**
 * `auth` and `storage` are inferred independently, so each seeds its own
 * named-type registry from its own columns — the same underlying
 * `String @db.Uuid` can come out as `Id` in one schema and `Owner` in the
 * other. Groups every declaration by structural signature (ignoring name),
 * keeps one canonical declaration per signature (the first-seen — `auth`'s
 * declarations are passed first), and returns the old-name -> canonical-name
 * map for every non-canonical name so callers fold it into the global
 * field-`typeName` rewrite alongside the model-rename maps.
 */
function canonicalizeNamedTypes(
  declarationLists: readonly (readonly PslNamedTypeDeclaration[])[],
): {
  readonly declarations: readonly PslNamedTypeDeclaration[];
  readonly renameMap: ReadonlyMap<string, string>;
} {
  const bySignature = new Map<string, PslNamedTypeDeclaration[]>();
  for (const list of declarationLists) {
    for (const declaration of list) {
      const signature = namedTypeSignature(declaration);
      const group = bySignature.get(signature);
      if (group) {
        group.push(declaration);
      } else {
        bySignature.set(signature, [declaration]);
      }
    }
  }

  const declarations: PslNamedTypeDeclaration[] = [];
  const renameMap = new Map<string, string>();
  for (const group of bySignature.values()) {
    const [canonical] = group;
    if (!canonical) continue;
    declarations.push(canonical);
    for (const declaration of group) {
      if (declaration.name !== canonical.name) {
        renameMap.set(declaration.name, canonical.name);
      }
    }
  }
  declarations.sort((a, b) => a.name.localeCompare(b.name));

  return { declarations, renameMap };
}

interface InferredSchema {
  readonly namespace: PslNamespace;
  readonly types: readonly PslNamedTypeDeclaration[];
}

async function introspectSchema(
  driver: Awaited<ReturnType<typeof postgresDriverDescriptor.create>>,
  schemaName: string,
): Promise<InferredSchema> {
  const controlStack = createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: postgresDriverDescriptor,
    extensionPacks: [],
  });
  const controlAdapter = postgresAdapterDescriptor.create(controlStack);

  const rawSchemaNode = await controlAdapter.introspect(driver, undefined, schemaName);
  PostgresDatabaseSchemaNode.assert(rawSchemaNode);
  const tree = omitColumns(rawSchemaNode, schemaName);

  const inferPslContract = postgresTargetDescriptor.inferPslContract;
  if (!inferPslContract) {
    throw new Error('generate-contract: postgres target descriptor has no inferPslContract');
  }
  const ast = inferPslContract(tree);
  const namespace = ast.namespaces.find((ns) => ns.name === schemaName);
  if (!namespace) {
    throw new Error(
      `generate-contract: expected inferPslContract("${schemaName}") to produce a "${schemaName}" ` +
        `namespace, got: ${ast.namespaces.map((ns) => ns.name).join(', ')}`,
    );
  }

  const rlsEnabledTables = new Set(
    Object.values(tree.namespaces[schemaName]?.tables ?? {})
      .filter((table) => table.rlsEnabled)
      .map((table) => table.name),
  );

  const defaultsFixed = applyDefaultOmissions(namespace, DEFAULT_OMISSIONS[schemaName] ?? {});
  const indexesFixed = applyIndexOmissions(defaultsFixed, INDEX_OMISSIONS[schemaName] ?? []);
  const rlsFixed = applyRlsEnablement(indexesFixed, rlsEnabledTables);
  return { namespace: rlsFixed, types: ast.types?.declarations ?? [] };
}

async function main(): Promise<void> {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let connectionString: string;

  if (explicitUrl) {
    connectionString = explicitUrl;
  } else {
    database = await createDevDatabase();
    connectionString = database.connectionString;
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await restoreSupabaseReference(client);
    } finally {
      await client.end();
    }
  }

  const driver = await postgresDriverDescriptor.create(connectionString);
  let auth: InferredSchema;
  let storage: InferredSchema;
  try {
    auth = await introspectSchema(driver, 'auth');
    storage = await introspectSchema(driver, 'storage');
  } finally {
    await driver.close();
    if (database) await database.close();
  }

  const authRenamed = renameModels(auth.namespace, MODEL_RENAMES['auth'] ?? {});
  const storageRenamed = renameModels(storage.namespace, MODEL_RENAMES['storage'] ?? {});
  const { declarations: canonicalTypes, renameMap: typeRenameMap } = canonicalizeNamedTypes([
    auth.types,
    storage.types,
  ]);

  const globalRenameMap = new Map<string, string>([
    ...authRenamed.renameMap,
    ...storageRenamed.renameMap,
    ...typeRenameMap,
  ]);

  const namespaces = [
    roleNamespace(),
    rewriteFieldTypeNames(authRenamed.namespace, globalRenameMap),
    rewriteFieldTypeNames(storageRenamed.namespace, globalRenameMap),
  ];

  const merged: PslDocumentAst = {
    kind: 'document',
    sourceId: 'supabase-reference',
    namespaces,
    ...(canonicalTypes.length > 0
      ? { types: { kind: 'types', declarations: canonicalTypes, span: SYNTHETIC_SPAN } }
      : {}),
    span: SYNTHETIC_SPAN,
  };

  const pslBlockDescriptors = postgresTargetDescriptor.authoring?.pslBlockDescriptors;
  if (!pslBlockDescriptors) {
    throw new Error(
      'generate-contract: postgres target descriptor has no authoring.pslBlockDescriptors',
    );
  }
  const pslContent = printPsl(merged, { pslBlockDescriptors });

  const contractPrismaPath = join(packageRoot, 'src', 'contract', 'contract.prisma');
  writeFileSync(contractPrismaPath, pslContent, 'utf8');
  process.stderr.write(`generate-contract: wrote ${contractPrismaPath}\n`);

  execFileSync(join(packageRoot, 'node_modules', '.bin', 'prisma-next'), ['contract', 'emit'], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
