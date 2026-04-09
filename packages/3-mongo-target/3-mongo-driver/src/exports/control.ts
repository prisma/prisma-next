import { errorRuntime } from '@prisma-next/errors/execution';
import type {
  ControlDriverDescriptor,
  ControlDriverInstance,
} from '@prisma-next/framework-components/control';
import { redactDatabaseUrl } from '@prisma-next/utils/redact-db-url';
import { type Db, MongoClient } from 'mongodb';

export class MongoControlDriver implements ControlDriverInstance<'mongo', 'mongo'> {
  readonly familyId = 'mongo' as const;
  readonly targetId = 'mongo' as const;
  readonly db: Db;
  readonly #client: MongoClient;

  constructor(db: Db, client: MongoClient) {
    this.db = db;
    this.#client = client;
  }

  query(): Promise<never> {
    throw new Error('MongoDB control driver does not support SQL queries');
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

const mongoControlDriverDescriptor: ControlDriverDescriptor<'mongo', 'mongo', MongoControlDriver> =
  {
    kind: 'driver',
    familyId: 'mongo',
    targetId: 'mongo',
    id: 'mongo',
    version: '0.0.1',
    capabilities: {},
    async create(url: string): Promise<MongoControlDriver> {
      const client = new MongoClient(url, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      try {
        await client.connect();
        const db = client.db();
        return new MongoControlDriver(db, client);
      } catch (error) {
        try {
          await client.close();
        } catch {
          // ignore cleanup error
        }
        const message = error instanceof Error ? error.message : String(error);
        const redacted = redactDatabaseUrl(url);
        throw errorRuntime('Database connection failed', {
          why: message,
          fix: 'Verify the MongoDB URL, ensure the database is reachable, and confirm credentials/permissions',
          meta: redacted,
        });
      }
    },
  };

export default mongoControlDriverDescriptor;
