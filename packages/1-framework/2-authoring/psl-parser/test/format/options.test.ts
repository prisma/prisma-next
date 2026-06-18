import { describe, expect, it } from 'vitest';
import { format, PslFormatError } from '../../src/exports/format';

describe('format indent option', () => {
  it('defaults to two spaces', () => {
    const out = format('model User {\nid Int\n}');
    expect(out).toEqual(['model User {', '  id Int', '}', ''].join('\n'));
  });

  it('honors a custom positive integer indent', () => {
    const out = format('model User {\nid Int\n}', { indent: 4 });
    expect(out).toEqual(['model User {', '    id Int', '}', ''].join('\n'));
  });

  it('honors the literal tab indent', () => {
    const out = format('model User {\nid Int\n}', { indent: 'tab' });
    expect(out).toEqual(['model User {', '\tid Int', '}', ''].join('\n'));
  });

  it('applies indent per nesting depth', () => {
    const out = format('namespace n {\nmodel M {\nid Int\n}\n}', { indent: 4 });
    expect(out).toEqual(
      ['namespace n {', '    model M {', '        id Int', '    }', '}', ''].join('\n'),
    );
  });

  it('rejects a zero indent', () => {
    expect(() => format('model User {\nid Int\n}', { indent: 0 })).toThrow();
  });

  it('rejects a negative indent', () => {
    expect(() => format('model User {\nid Int\n}', { indent: -2 })).toThrow();
  });

  it('rejects a non-integer indent', () => {
    expect(() => format('model User {\nid Int\n}', { indent: 2.5 })).toThrow();
  });

  it('rejects an unknown string indent', () => {
    // @ts-expect-error invalid indent value rejected at runtime
    expect(() => format('model User {\nid Int\n}', { indent: 'spaces' })).toThrow();
  });
});

describe('format newline option', () => {
  it('defaults to LF', () => {
    const out = format('model User {\nid Int\n}');
    expect(out).toEqual('model User {\n  id Int\n}\n');
  });

  it('honors CRLF', () => {
    const out = format('model User {\nid Int\n}', { newline: 'CRLF' });
    expect(out).toEqual('model User {\r\n  id Int\r\n}\r\n');
  });

  it('rejects an unknown newline value', () => {
    // @ts-expect-error invalid newline value rejected at runtime
    expect(() => format('model User {\nid Int\n}', { newline: 'CR' })).toThrow();
  });
});

describe('format refuse-on-diagnostics', () => {
  it('throws PslFormatError carrying diagnostics on diagnostic-bearing input', () => {
    expect(() => format('model {\n}')).toThrow(PslFormatError);
  });

  it('exposes the parser diagnostics on the thrown error', () => {
    let thrown: unknown;
    try {
      format('model {\n}');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PslFormatError);
    const error = thrown as PslFormatError;
    expect(error.diagnostics.length).toBeGreaterThan(0);
    expect(error.diagnostics[0]?.message).toBeTypeOf('string');
  });

  it('does not emit best-effort output for malformed input', () => {
    expect(() => format('model User {\nid Int @\n}')).toThrow(PslFormatError);
  });
});
