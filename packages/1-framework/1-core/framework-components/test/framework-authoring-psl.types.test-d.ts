/**
 * End-to-end type narrowing for a triple-bundle pack contribution
 * (`pslBlocks` + `pslPrinters` + `entityTypes`). The test pins the
 * load-bearing property: a pack literal that declares the matching
 * descriptors with `as const satisfies` produces a parser whose
 * `Output` type is the same AST node shape its printer's `Input`
 * consumes and its factory's `Input` accepts. The parser's
 * `Output` is also constrained to extend `PslPackBlock` so the
 * framework AST slot can hold it.
 *
 * Ref: TML-2804.
 */

import { expectTypeOf, test } from 'vitest';
import type {
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockNamespace,
  AuthoringPslPrinterNamespace,
} from '../src/shared/framework-authoring';
import type { PslPackBlock, PslPackBlockParserContext } from '../src/shared/psl-substrate';

interface FixtureAst extends PslPackBlock {
  readonly kind: 'fixture-block';
  readonly predicate: string;
}

type FixtureInput = {
  readonly name: string;
  readonly predicate: string;
};

const fixturePslBlocks = {
  fixture: {
    kind: 'pslBlock',
    discriminator: 'fixture-block',
    parser: (ctx: PslPackBlockParserContext): FixtureAst => ({
      kind: 'fixture-block',
      name: ctx.name,
      span: ctx.lineRangeSpan(ctx.bounds.startLine, ctx.bounds.endLine),
      predicate: '',
    }),
  },
} as const satisfies AuthoringPslBlockNamespace;

const fixturePslPrinters = {
  fixture: {
    kind: 'pslPrinter',
    discriminator: 'fixture-block',
    printer: (_input: FixtureAst, _context: unknown): void => undefined,
  },
} as const satisfies AuthoringPslPrinterNamespace;

const fixtureEntityTypes = {
  fixture: {
    kind: 'entity',
    discriminator: 'fixture-block',
    output: {
      factory: (_input: FixtureInput): FixtureAst => ({
        kind: 'fixture-block',
        name: '',
        span: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 0, line: 1, column: 1 },
        },
        predicate: '',
      }),
    },
  },
} as const satisfies AuthoringEntityTypeNamespace;

test('parser Output narrows to AST shape consumed by printer Input', () => {
  type ParserOutput = ReturnType<typeof fixturePslBlocks.fixture.parser>;
  type PrinterInput = Parameters<typeof fixturePslPrinters.fixture.printer>[0];

  expectTypeOf<ParserOutput>().toEqualTypeOf<FixtureAst>();
  expectTypeOf<PrinterInput>().toEqualTypeOf<FixtureAst>();
  expectTypeOf<ParserOutput>().toExtend<PrinterInput>();
});

test('parser Output narrows to AST shape produced by entityTypes factory', () => {
  type ParserOutput = ReturnType<typeof fixturePslBlocks.fixture.parser>;
  type FactoryOutput = ReturnType<typeof fixtureEntityTypes.fixture.output.factory>;

  expectTypeOf<ParserOutput>().toEqualTypeOf<FactoryOutput>();
});

test('parser Output extends PslPackBlock so it fits the AST packBlocks slot', () => {
  type ParserOutput = ReturnType<typeof fixturePslBlocks.fixture.parser>;
  expectTypeOf<ParserOutput>().toExtend<PslPackBlock>();
});

test('discriminator strings carry as literal types', () => {
  expectTypeOf<typeof fixturePslBlocks.fixture.discriminator>().toEqualTypeOf<'fixture-block'>();
  expectTypeOf<typeof fixturePslPrinters.fixture.discriminator>().toEqualTypeOf<'fixture-block'>();
  expectTypeOf<typeof fixtureEntityTypes.fixture.discriminator>().toEqualTypeOf<'fixture-block'>();
});
