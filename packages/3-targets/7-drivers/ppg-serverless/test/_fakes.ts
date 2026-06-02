/**
 * Hand-built fakes for `@prisma/ppg` types. Tests import these and pass them
 * to the driver via the `{ kind: 'ppgClient' }` binding, so we exercise the
 * real driver lifecycle without standing up a WebSocket server or mocking the
 * `@prisma/ppg` module.
 */
import type { Column, Client as PpgClient, Resultset, Row, Session } from '@prisma/ppg';

export interface ResultsetSpec {
  readonly columns: ReadonlyArray<Column>;
  readonly rows: ReadonlyArray<Row>;
}

export type QueryHandler = (
  sql: string,
  params: readonly unknown[],
) => ResultsetSpec | Promise<ResultsetSpec> | Error | Promise<Error>;

export interface FakeClientControls {
  readonly client: PpgClient;
  readonly newSessionCalls: () => number;
  readonly queryCalls: () => Array<{ sql: string; params: readonly unknown[] }>;
  readonly sessionCloseCalls: () => number;
}

export function makeFakeClient(handler: QueryHandler): FakeClientControls {
  let newSessionCount = 0;
  let sessionCloseCount = 0;
  const queryCalls: Array<{ sql: string; params: readonly unknown[] }> = [];

  const newSession = async (): Promise<Session> => {
    newSessionCount++;
    let active = true;
    const session: Session = {
      query: async (sql: string, ...params: unknown[]): Promise<Resultset> => {
        queryCalls.push({ sql, params });
        const out = await handler(sql, params);
        if (out instanceof Error) {
          throw out;
        }
        return makeResultset(out);
      },
      exec: async (_sql: string, ..._params: unknown[]): Promise<number> => {
        throw new Error('fake-client: exec not implemented for tests');
      },
      close: () => {
        sessionCloseCount++;
        active = false;
      },
      get active() {
        return active;
      },
      [Symbol.dispose]() {
        this.close();
      },
    };
    return session;
  };

  const client: PpgClient = {
    newSession,
    query: async (_sql: string, ..._params: unknown[]) => {
      throw new Error('fake-client: top-level query not used by the driver');
    },
    exec: async (_sql: string, ..._params: unknown[]) => {
      throw new Error('fake-client: top-level exec not used by the driver');
    },
  };

  return {
    client,
    newSessionCalls: () => newSessionCount,
    queryCalls: () => queryCalls,
    sessionCloseCalls: () => sessionCloseCount,
  };
}

function makeResultset(spec: ResultsetSpec): Resultset {
  const rows = [...spec.rows];
  let i = 0;
  const iter = {
    async next(): Promise<IteratorResult<Row>> {
      if (i < rows.length) {
        const value = rows[i++] as Row;
        return { value, done: false };
      }
      return { value: undefined, done: true };
    },
    async return(): Promise<IteratorResult<Row>> {
      i = rows.length;
      return { value: undefined, done: true };
    },
    async collect(): Promise<Row[]> {
      const remaining = rows.slice(i);
      i = rows.length;
      return remaining;
    },
    [Symbol.asyncIterator]() {
      return iter;
    },
  };
  return {
    columns: [...spec.columns],
    rows: iter as unknown as Resultset['rows'],
  };
}

export function col(name: string, oid = 25): Column {
  return { name, oid };
}

export function row(...values: unknown[]): Row {
  return { values };
}
