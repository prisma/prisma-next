import { ParamRef } from '@prisma-next/sql-relational-core/ast';

export interface ParamMeta {
  readonly codecId?: string;
}

interface CollectedParam {
  readonly value: unknown;
  readonly meta: ParamMeta;
}

export class ParamCollector {
  private params: CollectedParam[] = [];

  add(value: unknown, meta: ParamMeta = {}): ParamRef {
    this.params.push({ value, meta });
    return ParamRef.of(this.params.length);
  }

  getValues(): unknown[] {
    return this.params.map((p) => p.value);
  }

  getMetas(): ParamMeta[] {
    return this.params.map((p) => p.meta);
  }

  get size(): number {
    return this.params.length;
  }

  clone(): ParamCollector {
    const copy = new ParamCollector();
    copy.params = [...this.params];
    return copy;
  }
}
