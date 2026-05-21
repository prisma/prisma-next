/**
 * Abstract base class for concrete SQL codec implementations.
 *
 * Extends the framework {@link CodecImpl} and adds the abstract `renderSqlLiteral(value)` method as the SQL family's structural enforcement of dialect-specific literal rendering. Concrete SQL codec subclasses (`SqlTextCodec`, `PgInt4Codec`, `SqliteIntegerCodec`, etc.) extend this class instead of the framework `CodecImpl`; the abstract method makes omitting `renderSqlLiteral` a compile-time error at the class-construction site.
 *
 * `renderSqlLiteral` returns a complete SQL fragment (e.g. `'TRUE'`, `'42'`, `''escaped string''`, `''2026-04-30T00:00:00Z'::timestamptz`) that the DDL renderer wraps as `DEFAULT (<expression>)`. Authors own dialect-specific escaping for adversarial inputs (single quotes, backslashes, NULL bytes, unicode) — the emitter performs no string concatenation around the result.
 */

import type { CodecTrait } from '@prisma-next/framework-components/codec';
import { CodecImpl } from '@prisma-next/framework-components/codec';

export abstract class SqlCodecImpl<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> extends CodecImpl<Id, TTraits, TWire, TInput> {
  abstract renderSqlLiteral(value: TInput): string;
}
