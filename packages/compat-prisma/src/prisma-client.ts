import { createRuntime, type Runtime } from '@prisma-next/runtime';
import { sql } from '@prisma-next/sql/sql';
import { schema } from '@prisma-next/sql/schema';
import { param } from '@prisma-next/sql/param';
import type { DataContract, SqlContract, DocumentContract } from '@prisma-next/contract/types';
import { isSqlContract } from '@prisma-next/contract/types';
import type { TableRef, ColumnBuilder } from '@prisma-next/sql/types';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriver } from '@prisma-next/driver-postgres';

interface PrismaClientOptions {
  readonly contract: DataContract;
  readonly runtime?: Runtime;
  readonly connectionString?: string;
}

interface FindUniqueArgs {
  readonly where: Record<string, unknown>;
  readonly select?: Record<string, boolean>;
}

interface FindManyArgs {
  readonly where?: Record<string, unknown>;
  readonly select?: Record<string, boolean>;
  readonly orderBy?: Record<string, 'asc' | 'desc'>;
  readonly take?: number;
  readonly skip?: number;
}

interface FindFirstArgs extends FindManyArgs {}

// NOTE: we can rely on the Prisma ORM's complex type definitions for the method return values, we only need to ensure the compatibility layer behaves correctly at runtime
class ModelDelegate {
  private readonly tableName: string;
  private readonly tableRef: TableRef;

  constructor(
    private readonly runtime: Runtime,
    private readonly contract: SqlContract, // Narrowed from DataContract in PrismaClientImpl
    private readonly table: TableRef & Record<string, ColumnBuilder>,
    private readonly schemaTables: ReturnType<typeof schema>['tables'],
    tableName: string,
  ) {
    // Store table name explicitly (from schema key)
    this.tableName = tableName;
    // Create a clean TableRef that preserves the name property
    // Object.assign in TableBuilderImpl may have overwritten name if there's a column named 'name'
    // We preserve the original table for column access but create a clean ref for from() calls
    this.tableRef = Object.freeze({
      kind: 'table' as const,
      name: tableName,
    }) as TableRef;
  }

  async findUnique(args: FindUniqueArgs): Promise<Record<string, unknown> | null> {
    const result = await this.findMany({
      ...args,
      take: 1,
    });

    return result[0] ?? null;
  }

  async findFirst(args: FindFirstArgs = {}): Promise<Record<string, unknown> | null> {
    const result = await this.findMany({
      ...args,
      take: 1,
    });

    return result[0] ?? null;
  }

  async findMany(args: FindManyArgs = {}): Promise<Record<string, unknown>[]> {
    const tableName = this.tableName;
    const adapter = createPostgresAdapter();
    const query = sql({ contract: this.contract, adapter });

    query.from(this.tableRef);

    // Handle where clause (equality only for MVP)
    if (args.where) {
      this.validateWhereArgs(args.where);
      const whereConditions: Array<{ column: ColumnBuilder; value: unknown }> = [];

      for (const [field, value] of Object.entries(args.where)) {
        // Check contract first to validate field exists
        const tableDef = this.contract.storage.tables[this.tableName];
        if (!tableDef || !tableDef.columns[field]) {
          throw this.unsupportedError(`Unknown field '${field}' in where clause`);
        }
        // Access column from table object (columns are assigned as properties)
        const column = this.table[field];
        if (
          !column ||
          typeof column !== 'object' ||
          !('kind' in column) ||
          column.kind !== 'column'
        ) {
          throw this.unsupportedError(`Invalid column '${field}' in where clause`);
        }
        whereConditions.push({ column, value });
      }

      if (whereConditions.length === 1) {
        const { column } = whereConditions[0];
        const paramPlaceholder = param(`${tableName}_${column.column}`);
        query.where(column.eq(paramPlaceholder));
      } else if (whereConditions.length > 1) {
        throw this.unsupportedError('Multiple where conditions (AND/OR) not supported in MVP');
      }
    }

    // Handle select projection
    const projection: Record<string, ColumnBuilder> = {};
    if (args.select) {
      for (const [field, include] of Object.entries(args.select)) {
        if (include) {
          // Check contract first, then access column
          const tableDef = this.contract.storage.tables[this.tableName];
          if (!tableDef || !tableDef.columns[field]) {
            throw this.unsupportedError(`Unknown field '${field}' in select clause`);
          }
          const column = this.table[field];
          if (
            !column ||
            typeof column !== 'object' ||
            !('kind' in column) ||
            column.kind !== 'column'
          ) {
            throw this.unsupportedError(`Invalid column '${field}' in select clause`);
          }
          projection[field] = column;
        }
      }
    } else {
      // Default: select all columns from contract definition
      const tableDef = this.contract.storage.tables[tableName];
      if (tableDef) {
        for (const columnName of Object.keys(tableDef.columns)) {
          // Access column from original table object (columns are assigned as properties)
          const column = this.table[columnName];
          if (
            column &&
            typeof column === 'object' &&
            'kind' in column &&
            column.kind === 'column'
          ) {
            projection[columnName] = column;
          }
        }
      }

      // Fallback: iterate table properties to find columns
      if (Object.keys(projection).length === 0) {
        for (const key in this.table) {
          if (key === 'name' || key === 'kind') {
            continue; // Skip name/kind properties
          }
          const value = this.table[key];
          if (value && typeof value === 'object' && 'kind' in value && value.kind === 'column') {
            projection[key] = value;
          }
        }
      }

      if (Object.keys(projection).length === 0) {
        throw this.unsupportedError('Select projection cannot be empty');
      }
    }

    query.select(projection);

    // Handle orderBy
    if (args.orderBy) {
      const orderByEntries = Object.entries(args.orderBy);
      if (orderByEntries.length > 1) {
        throw this.unsupportedError('Multiple orderBy fields not supported in MVP');
      }

      const [field, direction] = orderByEntries[0];
      const tableDef = this.contract.storage.tables[this.tableName];
      if (!tableDef || !tableDef.columns[field]) {
        throw this.unsupportedError(`Unknown field '${field}' in orderBy clause`);
      }
      const column = this.table[field];
      if (
        !column ||
        typeof column !== 'object' ||
        !('kind' in column) ||
        column.kind !== 'column'
      ) {
        throw this.unsupportedError(`Invalid column '${field}' in orderBy clause`);
      }

      query.orderBy(direction === 'asc' ? column.asc() : column.desc());
    }

    // Handle pagination
    if (args.take !== undefined) {
      query.limit(args.take);
    }

    if (args.skip !== undefined) {
      throw this.unsupportedError('skip/OFFSET not supported in MVP');
    }

    // Build plan with params
    const paramsMap: Record<string, unknown> = {};
    if (args.where) {
      for (const [field, value] of Object.entries(args.where)) {
        paramsMap[`${tableName}_${field}`] = value;
      }
    }

    const plan = query.build({ params: paramsMap });

    // Execute via runtime
    const results: Record<string, unknown>[] = [];
    for await (const row of this.runtime.execute(plan)) {
      results.push(row);
    }

    return results;
  }

  async create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const tableName = this.tableName;
    const tableDef = this.contract.storage.tables[tableName];

    if (!tableDef) {
      throw new Error(`Table ${tableName} not found in contract`);
    }

    // Build INSERT statement using raw SQL (MVP: simple inserts only)
    const columns: string[] = [];
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const [field, value] of Object.entries(args.data)) {
      const columnDef = tableDef.columns[field];
      if (!columnDef) {
        throw this.unsupportedError(`Unknown field '${field}' in create data`);
      }

      // Skip auto-generated fields (id with default, createdAt with default, etc.)
      // For MVP, we'll include all provided fields
      columns.push(`"${field}"`);
      values.push(value);
      placeholders.push(`$${paramIndex}`);
      paramIndex++;
    }

    if (columns.length === 0) {
      throw this.unsupportedError('create() requires at least one field in data');
    }

    // Use raw SQL for INSERT (MVP approach)
    const sqlBuilder = sql({ contract: this.contract, adapter: createPostgresAdapter() });
    const insertPlan = sqlBuilder.raw(
      `INSERT INTO "${tableName}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      {
        params: values,
        annotations: {
          intent: 'write',
          isMutation: true,
          hasWhere: false,
          hasLimit: false,
        },
      },
    );

    // Execute and return the created row
    const results: Record<string, unknown>[] = [];
    for await (const row of this.runtime.execute(insertPlan)) {
      results.push(row);
    }

    if (results.length === 0) {
      throw new Error('INSERT did not return a row');
    }

    return results[0];
  }

  async update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    throw this.unsupportedError('update() mutations are not supported in MVP compatibility layer');
  }

  async delete(args: { where: Record<string, unknown> }): Promise<Record<string, unknown>> {
    throw this.unsupportedError('delete() mutations are not supported in MVP compatibility layer');
  }

  private validateWhereArgs(where: Record<string, unknown>): void {
    // MVP: only simple equality is supported
    for (const [field, value] of Object.entries(where)) {
      if (value === null || value === undefined) {
        throw this.unsupportedError(`Null/undefined values in where clause not supported in MVP`);
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        throw this.unsupportedError(
          `Complex where predicates (e.g., {${field}: {gt: ...}}) not supported in MVP`,
        );
      }
      if (Array.isArray(value)) {
        throw this.unsupportedError(`IN/NOT IN predicates not supported in MVP`);
      }
    }
  }

  private unsupportedError(message: string): Error {
    const error = new Error(message) as Error & {
      code: string;
      category: string;
      severity: string;
    };
    error.code = 'CONFIG.INVALID';
    error.category = 'CONFIG';
    error.severity = 'error';
    return error;
  }
}

class PrismaClientImpl {
  readonly runtime: Runtime;
  readonly contract: SqlContract;
  readonly schemaHandle: ReturnType<typeof schema>;
  readonly models: Record<string, ModelDelegate> = {};

  // Dynamic model access properties (populated at runtime)
  [key: string]: unknown;

  constructor(options: PrismaClientOptions) {
    // Support both SQL and Document contracts (currently only SQL is implemented)
    if (!isSqlContract(options.contract)) {
      throw new Error(
        `Document contracts are not yet supported in PrismaClient compatibility layer. ` +
          `Only SQL contracts (targetFamily: 'sql') are currently supported.`,
      );
    }
    this.contract = options.contract;

    // Initialize runtime if not provided
    if (options.runtime) {
      this.runtime = options.runtime;
    } else {
      const adapter = createPostgresAdapter();
      const connectionString = options.connectionString ?? process.env.DATABASE_URL;

      if (!connectionString) {
        throw new Error('DATABASE_URL environment variable or connectionString option is required');
      }

      const driver = createPostgresDriver(connectionString);

      this.runtime = createRuntime({
        contract: this.contract,
        adapter,
        driver,
        verify: {
          mode: 'onFirstUse',
          requireMarker: false,
        },
      });
    }

    // Initialize schema handle
    this.schemaHandle = schema(this.contract);

    // Build model delegates
    for (const [tableName, table] of Object.entries(this.schemaHandle.tables)) {
      // Convert table name to camelCase model name (e.g., "user" -> "user", "User" -> "user")
      const modelName = tableName.charAt(0).toLowerCase() + tableName.slice(1);
      // Pass tableName explicitly since Object.assign in TableBuilderImpl may interfere with name property
      this.models[modelName] = new ModelDelegate(
        this.runtime,
        this.contract,
        table as unknown as TableRef & Record<string, ColumnBuilder>,
        this.schemaHandle.tables,
        tableName,
      );
    }
  }

  async $disconnect(): Promise<void> {
    await this.runtime.close();
  }
}

// Export PrismaClient as a Proxy-wrapped class for dynamic model access
export class PrismaClient extends PrismaClientImpl {
  // Declare user model for TypeScript (MVP: assumes user table exists)
  declare readonly user: ModelDelegate;

  constructor(options: PrismaClientOptions) {
    super(options);
    const proxy = new Proxy(this, {
      get(target, prop) {
        if (prop in target && prop !== 'models') {
          return (target as any)[prop];
        }

        // Check if it's a model name
        if (typeof prop === 'string' && target.models[prop]) {
          return target.models[prop];
        }

        return undefined;
      },
    });

    // Copy model properties to instance for TypeScript type checking
    for (const [modelName, delegate] of Object.entries(this.models)) {
      (proxy as any)[modelName] = delegate;
    }

    return proxy;
  }
}
