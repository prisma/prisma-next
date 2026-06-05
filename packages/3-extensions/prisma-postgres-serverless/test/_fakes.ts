/**
 * Slim local fake of `@prisma/ppg`'s `Client` / `Session` / `Resultset`
 * surface, scoped to what the facade end-to-end test needs: a `Client` whose
 * `newSession()` returns a `Session` whose `query` returns a canned
 * resultset. Not a substitute for the driver-package fake — that one has
 * richer probes (per-session history, close counts, transaction-statement
 * shortcuts) the facade does not exercise from this boundary.
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

export function makeFakeClient(handler: QueryHandler): PpgClient {
  const newSession = async (): Promise<Session> => {
    let active = true;
    const session: Session = {
      query: async (sql: string, ...params: unknown[]): Promise<Resultset> => {
        const out = await handler(sql, params);
        if (out instanceof Error) {
          throw out;
        }
        return makeResultset(out);
      },
      exec: async (_sql: string, ..._params: unknown[]): Promise<number> => {
        throw new Error('fake-ppg-client: exec not implemented for tests');
      },
      close: () => {
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

  return {
    newSession,
    query: async (_sql: string, ..._params: unknown[]) => {
      throw new Error('fake-ppg-client: top-level query not used by the driver');
    },
    exec: async (_sql: string, ..._params: unknown[]) => {
      throw new Error('fake-ppg-client: top-level exec not used by the driver');
    },
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
