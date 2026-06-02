import type {
  Contract,
  ContractMarkerRecord,
  LedgerEntryRecord,
} from '@prisma-next/contract/types';
import type {
  TargetBoundComponentDescriptor,
  TargetDescriptor,
} from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  ControlStack,
  CoreSchemaView,
  MigrationPlanOperation,
  OperationPreview,
  OperationPreviewCapable,
  PslContractInferCapable,
  SchemaViewCapable,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import {
  APP_SPACE_ID,
  SchemaTreeNode,
  VERIFY_CODE_HASH_MISMATCH,
  VERIFY_CODE_MARKER_MISSING,
  VERIFY_CODE_TARGET_MISMATCH,
} from '@prisma-next/framework-components/control';
import type { TypesImportSpec } from '@prisma-next/framework-components/emission';
import type { PslDocumentAst } from '@prisma-next/framework-components/psl-ast';
import { assertDescriptorSelfConsistency } from '@prisma-next/migration-tools/spaces';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  AnyQueryAst,
  DdlNode,
  LoweredStatement,
  LowererContext,
} from '@prisma-next/sql-relational-core/ast';
import { writeContractMarker } from '@prisma-next/sql-runtime';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type { SqlSchemaIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type { SqlControlAdapter } from './control-adapter';
import { SqlContractSerializer } from './ir/sql-contract-serializer';
import type {
  SqlControlAdapterDescriptor,
  SqlControlExtensionDescriptor,
} from './migrations/types';
import { sqlOperationsToPreview } from './operation-preview';
import { sqlSchemaIrToPslAst } from './psl-contract-infer/sql-schema-ir-to-psl-ast';
import { verifySqlSchema } from './schema-verify/verify-sql-schema';
import { collectSupportedCodecTypeIds } from './verify';

function extractCodecTypeIdsFromContract(contract: unknown): readonly string[] {
  const typeIds = new Set<string>();

  // Type guard for SQL contract structure
  if (
    typeof contract === 'object' &&
    contract !== null &&
    'storage' in contract &&
    typeof contract.storage === 'object' &&
    contract.storage !== null &&
    'namespaces' in contract.storage &&
    typeof contract.storage.namespaces === 'object' &&
    contract.storage.namespaces !== null
  ) {
    const namespaces = contract.storage.namespaces as Record<
      string,
      { readonly tables?: Readonly<Record<string, unknown>> }
    >;
    for (const ns of Object.values(namespaces)) {
      const tbls = ns.tables;
      if (typeof tbls !== 'object' || tbls === null) continue;
      for (const table of Object.values(tbls)) {
        if (
          typeof table === 'object' &&
          table !== null &&
          'columns' in table &&
          typeof table.columns === 'object' &&
          table.columns !== null
        ) {
          const columns = table.columns as Record<string, { codecId: string } | undefined>;
          for (const column of Object.values(columns)) {
            if (
              column &&
              typeof column === 'object' &&
              'codecId' in column &&
              typeof column.codecId === 'string'
            ) {
              typeIds.add(column.codecId);
            }
          }
        }
      }
    }
  }

  return Array.from(typeIds).sort();
}

function createVerifyResult(options: {
  ok: boolean;
  code?: string;
  summary: string;
  contractStorageHash: string;
  contractProfileHash?: string;
  marker?: ContractMarkerRecord;
  expectedTargetId: string;
  actualTargetId?: string;
  missingCodecs?: readonly string[];
  codecCoverageSkipped?: boolean;
  configPath?: string;
  contractPath: string;
  totalTime: number;
}): VerifyDatabaseResult {
  const contract: { storageHash: string; profileHash?: string } = {
    storageHash: options.contractStorageHash,
  };
  if (options.contractProfileHash) {
    contract.profileHash = options.contractProfileHash;
  }

  const target: { expected: string; actual?: string } = {
    expected: options.expectedTargetId,
  };
  if (options.actualTargetId) {
    target.actual = options.actualTargetId;
  }

  const meta: { contractPath: string; configPath?: string } = {
    contractPath: options.contractPath,
  };
  if (options.configPath) {
    meta.configPath = options.configPath;
  }

  const result: VerifyDatabaseResult = {
    ok: options.ok,
    summary: options.summary,
    contract,
    target,
    meta,
    timings: {
      total: options.totalTime,
    },
  };

  if (options.code) {
    (result as { code?: string }).code = options.code;
  }

  if (options.marker) {
    (result as { marker?: { storageHash: string; profileHash: string } }).marker = {
      storageHash: options.marker.storageHash,
      profileHash: options.marker.profileHash,
    };
  }

  if (options.missingCodecs) {
    (result as { missingCodecs?: readonly string[] }).missingCodecs = options.missingCodecs;
  }

  if (options.codecCoverageSkipped) {
    (result as { codecCoverageSkipped?: boolean }).codecCoverageSkipped =
      options.codecCoverageSkipped;
  }

  return result;
}

interface SqlTypeMetadata {
  readonly typeId: string;
  readonly familyId: 'sql';
  readonly targetId: string;
  readonly nativeType?: string;
}

type SqlTypeMetadataRegistry = Map<string, SqlTypeMetadata>;

interface SqlFamilyInstanceState {
  readonly codecTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
  readonly typeMetadataRegistry: SqlTypeMetadataRegistry;
}

export interface SqlControlFamilyInstance
  extends ControlFamilyInstance<'sql', SqlSchemaIR>,
    SchemaViewCapable<SqlSchemaIR>,
    PslContractInferCapable<SqlSchemaIR>,
    OperationPreviewCapable,
    SqlFamilyInstanceState {
  /**
   * The family seam-of-record for on-disk contract reads. Structurally
   * validates the JSON envelope, then hydrates IR-class instances via
   * the per-target ContractSerializer. The single named entry point
   * every CLI on-disk read crosses (TML-2536) — `as Contract` casts
   * in production package sources are a serializer-bypass smell guarded
   * by `pnpm lint:no-contract-cast`.
   */
  deserializeContract(contractJson: unknown): Contract;

  verify(options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly contract: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseResult>;

  /**
   * Verify a contract against an already-introspected schema slice.
   *
   * Callers that need to verify against the live database compose
   * `introspect({ driver })` + `verifySchema({ contract, schema, ... })`.
   * The aggregate verifier projects each member's claimed slice via
   * `projectSchemaToSpace` and hands the projected slice in — this
   * keeps per-member verification from surfacing sibling-space tables
   * as `extras`.
   */
  verifySchema(options: {
    readonly contract: unknown;
    readonly schema: SqlSchemaIR;
    readonly strict: boolean;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  }): VerifyDatabaseSchemaResult;

  sign(options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly contract: unknown;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<SignDatabaseResult>;

  introspect(options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly contract?: unknown;
  }): Promise<SqlSchemaIR>;

  inferPslContract(schemaIR: SqlSchemaIR): PslDocumentAst;

  lowerAst(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement;

  bootstrapControlTableQueries(): readonly DdlNode[];

  bootstrapSignMarkerQueries(): readonly DdlNode[];

  toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview;
}

export type SqlFamilyInstance = SqlControlFamilyInstance;

interface DescriptorWithStorageTypes {
  readonly targetId?: string | undefined;
  readonly types?:
    | {
        readonly storage?:
          | ReadonlyArray<{
              readonly typeId: string;
              readonly familyId: string;
              readonly targetId: string;
              readonly nativeType?: string | undefined;
            }>
          | undefined;
      }
    | undefined;
}

function buildSqlTypeMetadataRegistry(options: {
  readonly target: DescriptorWithStorageTypes;
  readonly adapter: DescriptorWithStorageTypes & { readonly targetId: string };
  readonly extensionPacks: readonly DescriptorWithStorageTypes[];
}): SqlTypeMetadataRegistry {
  const { target, adapter, extensionPacks: extensions } = options;
  const registry = new Map<string, SqlTypeMetadata>();
  const targetId = adapter.targetId;
  const descriptors = [target, adapter, ...extensions];

  for (const descriptor of descriptors) {
    const types = descriptor.types;
    const storageTypes = types?.storage;

    if (!storageTypes) {
      continue;
    }

    for (const storageType of storageTypes) {
      if (storageType.familyId === 'sql' && storageType.targetId === targetId) {
        registry.set(storageType.typeId, {
          typeId: storageType.typeId,
          familyId: 'sql',
          targetId: storageType.targetId,
          ...(storageType.nativeType !== undefined ? { nativeType: storageType.nativeType } : {}),
        });
      }
    }
  }

  return registry;
}

export function createSqlFamilyInstance<TTargetId extends string>(
  stack: ControlStack<'sql', TTargetId>,
): SqlFamilyInstance {
  if (!stack.adapter) {
    throw new Error('SQL family requires an adapter descriptor in ControlStack');
  }

  const target = stack.target as unknown as TargetDescriptor<'sql', TTargetId> &
    DescriptorWithStorageTypes;
  const adapter = stack.adapter as unknown as SqlControlAdapterDescriptor<TTargetId> &
    DescriptorWithStorageTypes;
  const extensions =
    stack.extensionPacks as unknown as readonly (SqlControlExtensionDescriptor<TTargetId> &
      DescriptorWithStorageTypes)[];

  // Descriptor self-consistency check.
  // Each extension that exposes a `contractSpace` must publish a
  // `headRef.hash` that matches the canonical hash recomputed from its
  // `contractJson`. A stale value would silently corrupt every downstream
  // boundary that trusts `headRef.hash` as the canonical identity (drift
  // detection, on-disk artefact emission, runner marker writes). Failing
  // fast at descriptor-load time turns "extension author shipped an
  // inconsistent descriptor" into an explicit, actionable error
  // (`MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH`) rather than a confusing
  // mismatch surfacing several layers downstream.
  for (const extension of extensions) {
    if (extension.contractSpace) {
      const { contractJson, headRef } = extension.contractSpace;
      assertDescriptorSelfConsistency({
        extensionId: extension.id,
        target: contractJson.target,
        targetFamily: contractJson.targetFamily,
        storage: contractJson.storage,
        headRefHash: headRef.hash,
        ...sqlContractCanonicalizationHooks,
      });
    }
  }

  const { codecTypeImports, extensionIds } = stack;

  const typeMetadataRegistry = buildSqlTypeMetadataRegistry({
    target,
    adapter,
    extensionPacks: extensions,
  });

  // Family-instance methods accept `ControlDriverInstance<'sql', string>` — the
  // family API isn't generic on the target id. The adapter descriptor's `create`
  // returns the concrete `SqlControlAdapter<TTargetId>`; widening the target id to
  // `string` here matches the family-level driver type without a per-method probe.
  const getControlAdapter = (): SqlControlAdapter<string> => adapter.create(stack);

  const targetSerializer = (
    target as unknown as {
      contractSerializer?: { deserializeContract(json: unknown): Contract<SqlStorage> };
    }
  ).contractSerializer;
  const deserializeWithTargetSerializer = (contractJson: unknown): Contract<SqlStorage> => {
    const serializer = targetSerializer ?? new SqlContractSerializer();
    return serializer.deserializeContract(contractJson) as Contract<SqlStorage>;
  };

  return {
    familyId: 'sql',
    codecTypeImports,
    extensionIds,
    typeMetadataRegistry,

    deserializeContract(contractJson: unknown): Contract {
      return deserializeWithTargetSerializer(contractJson);
    },

    async verify(verifyOptions: {
      readonly driver: ControlDriverInstance<'sql', string>;
      readonly contract: unknown;
      readonly expectedTargetId: string;
      readonly contractPath: string;
      readonly configPath?: string;
    }): Promise<VerifyDatabaseResult> {
      const {
        driver,
        contract: rawContract,
        expectedTargetId,
        contractPath,
        configPath,
      } = verifyOptions;
      const startTime = Date.now();

      const contract = deserializeWithTargetSerializer(rawContract) as Contract<SqlStorage>;

      const contractStorageHash = contract.storage.storageHash;
      const contractProfileHash = contract.profileHash;
      const contractTarget = contract.target;

      const marker = await getControlAdapter().readMarker(driver, APP_SPACE_ID);

      let missingCodecs: readonly string[] | undefined;
      let codecCoverageSkipped = false;
      const supportedTypeIds = collectSupportedCodecTypeIds([adapter, target, ...extensions]);
      if (supportedTypeIds.length === 0) {
        codecCoverageSkipped = true;
      } else {
        const supportedSet = new Set(supportedTypeIds);
        const usedTypeIds = extractCodecTypeIdsFromContract(contract);
        const missing = usedTypeIds.filter((id) => !supportedSet.has(id));
        if (missing.length > 0) {
          missingCodecs = missing;
        }
      }

      if (!marker) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: VERIFY_CODE_MARKER_MISSING,
          summary: 'Marker missing',
          contractStorageHash,
          expectedTargetId,
          contractPath,
          totalTime,
          ...(contractProfileHash ? { contractProfileHash } : {}),
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
        });
      }

      if (contractTarget !== expectedTargetId) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: VERIFY_CODE_TARGET_MISMATCH,
          summary: 'Target mismatch',
          contractStorageHash,
          marker,
          expectedTargetId,
          actualTargetId: contractTarget,
          contractPath,
          totalTime,
          ...(contractProfileHash ? { contractProfileHash } : {}),
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
        });
      }

      if (marker.storageHash !== contractStorageHash) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: VERIFY_CODE_HASH_MISMATCH,
          summary: 'Hash mismatch',
          contractStorageHash,
          marker,
          expectedTargetId,
          contractPath,
          totalTime,
          ...(contractProfileHash ? { contractProfileHash } : {}),
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
        });
      }

      if (contractProfileHash && marker.profileHash !== contractProfileHash) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: VERIFY_CODE_HASH_MISMATCH,
          summary: 'Hash mismatch',
          contractStorageHash,
          contractProfileHash,
          marker,
          expectedTargetId,
          contractPath,
          totalTime,
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
        });
      }

      const totalTime = Date.now() - startTime;
      return createVerifyResult({
        ok: true,
        summary: 'Database matches contract',
        contractStorageHash,
        marker,
        expectedTargetId,
        contractPath,
        totalTime,
        ...(contractProfileHash ? { contractProfileHash } : {}),
        ...(missingCodecs ? { missingCodecs } : {}),
        ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
        ...(configPath ? { configPath } : {}),
      });
    },

    verifySchema(options: {
      readonly contract: unknown;
      readonly schema: SqlSchemaIR;
      readonly strict: boolean;
      readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
    }): VerifyDatabaseSchemaResult {
      const contract = deserializeWithTargetSerializer(options.contract) as Contract<SqlStorage>;
      const controlAdapter = getControlAdapter();
      const resolveExistingEnumValues =
        controlAdapter.resolveExistingEnumValuesForContract?.(contract) ??
        controlAdapter.resolveExistingEnumValues;
      return verifySqlSchema({
        contract,
        schema: options.schema,
        strict: options.strict,
        typeMetadataRegistry,
        frameworkComponents: options.frameworkComponents,
        ...ifDefined('normalizeDefault', controlAdapter.normalizeDefault),
        ...ifDefined('normalizeNativeType', controlAdapter.normalizeNativeType),
        ...ifDefined('resolveExistingEnumValues', resolveExistingEnumValues),
      });
    },
    async sign(options: {
      readonly driver: ControlDriverInstance<'sql', string>;
      readonly contract: unknown;
      readonly contractPath: string;
      readonly configPath?: string;
    }): Promise<SignDatabaseResult> {
      const { driver, contract: contractInput, contractPath, configPath } = options;
      const startTime = Date.now();

      const contract = deserializeWithTargetSerializer(contractInput) as Contract<SqlStorage>;

      const contractStorageHash = contract.storage.storageHash;
      const contractProfileHash =
        'profileHash' in contract && typeof contract.profileHash === 'string'
          ? contract.profileHash
          : contractStorageHash;
      const contractTarget = contract.target;

      const controlAdapter = getControlAdapter();
      const lowererContext = { contract };
      for (const query of controlAdapter.bootstrapSignMarkerQueries()) {
        const lowered = controlAdapter.lower(query, lowererContext);
        await driver.query(lowered.sql, lowered.params);
      }

      const existingMarker = await controlAdapter.readMarker(driver, APP_SPACE_ID);

      let markerCreated = false;
      let markerUpdated = false;
      let previousHashes: { storageHash?: string; profileHash?: string } | undefined;

      if (!existingMarker) {
        const write = writeContractMarker({
          space: APP_SPACE_ID,
          storageHash: contractStorageHash,
          profileHash: contractProfileHash,
          contractJson: contractInput,
          canonicalVersion: 1,
        });
        await driver.query(write.insert.sql, write.insert.params);
        markerCreated = true;
      } else {
        const existingStorageHash = existingMarker.storageHash;
        const existingProfileHash = existingMarker.profileHash;

        const storageHashMatches = existingStorageHash === contractStorageHash;
        const profileHashMatches = existingProfileHash === contractProfileHash;

        if (!storageHashMatches || !profileHashMatches) {
          previousHashes = {
            storageHash: existingStorageHash,
            profileHash: existingProfileHash,
          };
          const write = writeContractMarker({
            space: APP_SPACE_ID,
            storageHash: contractStorageHash,
            profileHash: contractProfileHash,
            contractJson: contractInput,
            canonicalVersion: existingMarker.canonicalVersion ?? 1,
          });
          await driver.query(write.update.sql, write.update.params);
          markerUpdated = true;
        }
      }

      let summary: string;
      if (markerCreated) {
        summary = 'Database signed (marker created)';
      } else if (markerUpdated) {
        summary = `Database signed (marker updated from ${previousHashes?.storageHash ?? 'unknown'})`;
      } else {
        summary = 'Database already signed with this contract';
      }

      const totalTime = Date.now() - startTime;

      return {
        ok: true,
        summary,
        contract: {
          storageHash: contractStorageHash,
          profileHash: contractProfileHash,
        },
        target: {
          expected: contractTarget,
          actual: contractTarget,
        },
        marker: {
          created: markerCreated,
          updated: markerUpdated,
          ...(previousHashes ? { previous: previousHashes } : {}),
        },
        meta: {
          contractPath,
          ...(configPath ? { configPath } : {}),
        },
        timings: {
          total: totalTime,
        },
      };
    },
    async readMarker(options: {
      readonly driver: ControlDriverInstance<'sql', string>;
      readonly space: string;
    }): Promise<ContractMarkerRecord | null> {
      return getControlAdapter().readMarker(options.driver, options.space);
    },
    async readAllMarkers(options: {
      readonly driver: ControlDriverInstance<'sql', string>;
    }): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
      return getControlAdapter().readAllMarkers(options.driver);
    },
    async readLedger(options: {
      readonly driver: ControlDriverInstance<'sql', string>;
      readonly space?: string;
    }): Promise<readonly LedgerEntryRecord[]> {
      return getControlAdapter().readLedger(options.driver, options.space);
    },
    async introspect(options: {
      readonly driver: ControlDriverInstance<'sql', string>;
      readonly contract?: unknown;
    }): Promise<SqlSchemaIR> {
      return getControlAdapter().introspect(options.driver, options.contract);
    },

    inferPslContract(schemaIR: SqlSchemaIR): PslDocumentAst {
      return sqlSchemaIrToPslAst(schemaIR);
    },

    lowerAst(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement {
      return getControlAdapter().lower(ast, context);
    },

    bootstrapControlTableQueries(): readonly DdlNode[] {
      return getControlAdapter().bootstrapControlTableQueries();
    },

    bootstrapSignMarkerQueries(): readonly DdlNode[] {
      return getControlAdapter().bootstrapSignMarkerQueries();
    },

    toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview {
      return sqlOperationsToPreview(operations);
    },

    toSchemaView(schema: SqlSchemaIR): CoreSchemaView {
      const tableNodes: readonly SchemaTreeNode[] = Object.entries(schema.tables).map(
        ([tableName, table]: [string, SqlTableIR]) => {
          const children: SchemaTreeNode[] = [];

          const columnNodes: SchemaTreeNode[] = [];
          for (const [columnName, column] of Object.entries(table.columns)) {
            const typeDisplay = column.nativeType;
            const nullability = column.nullable ? 'nullable' : 'not nullable';
            const label = `${columnName}: ${typeDisplay} (${nullability})`;
            columnNodes.push(
              new SchemaTreeNode({
                kind: 'field',
                id: `column-${tableName}-${columnName}`,
                label,
                meta: {
                  nativeType: column.nativeType,
                  nullable: column.nullable,
                  ...ifDefined('default', column.default),
                },
              }),
            );
          }

          if (columnNodes.length > 0) {
            children.push(
              new SchemaTreeNode({
                kind: 'collection',
                id: `columns-${tableName}`,
                label: 'columns',
                children: columnNodes,
              }),
            );
          }

          if (table.primaryKey) {
            const pkColumns = table.primaryKey.columns.join(', ');
            children.push(
              new SchemaTreeNode({
                kind: 'index',
                id: `primary-key-${tableName}`,
                label: `primary key: ${pkColumns}`,
                meta: {
                  columns: table.primaryKey.columns,
                  ...(table.primaryKey.name ? { name: table.primaryKey.name } : {}),
                },
              }),
            );
          }

          for (const unique of table.uniques) {
            const name = unique.name ?? `${tableName}_${unique.columns.join('_')}_unique`;
            const label = `unique ${name}`;
            children.push(
              new SchemaTreeNode({
                kind: 'index',
                id: `unique-${tableName}-${name}`,
                label,
                meta: {
                  columns: unique.columns,
                  unique: true,
                },
              }),
            );
          }

          for (const index of table.indexes) {
            const name = index.name ?? defaultIndexName(tableName, index.columns);
            const label = index.unique ? `unique index ${name}` : `index ${name}`;
            children.push(
              new SchemaTreeNode({
                kind: 'index',
                id: `index-${tableName}-${name}`,
                label,
                meta: {
                  columns: index.columns,
                  unique: index.unique,
                },
              }),
            );
          }

          const tableMeta: Record<string, unknown> = {};
          if (table.primaryKey) {
            tableMeta['primaryKey'] = table.primaryKey.columns;
            if (table.primaryKey.name) {
              tableMeta['primaryKeyName'] = table.primaryKey.name;
            }
          }
          if (table.foreignKeys.length > 0) {
            tableMeta['foreignKeys'] = table.foreignKeys.map((fk) => ({
              columns: fk.columns,
              referencedTable: fk.referencedTable,
              referencedColumns: fk.referencedColumns,
              ...(fk.name ? { name: fk.name } : {}),
            }));
          }

          return new SchemaTreeNode({
            kind: 'entity',
            id: `table-${tableName}`,
            label: `table ${tableName}`,
            ...(Object.keys(tableMeta).length > 0 ? { meta: tableMeta } : {}),
            ...(children.length > 0 ? { children } : {}),
          });
        },
      );

      return {
        root: new SchemaTreeNode({
          kind: 'root',
          id: 'sql-schema',
          label: 'database',
          ...(tableNodes.length > 0 ? { children: tableNodes } : {}),
        }),
      };
    },
  };
}
