import { describe, expect, it } from 'vitest';
import { renderImports } from '../src/render-imports';

describe('renderImports', () => {
  it('returns the empty string for an empty requirement list', () => {
    expect(renderImports([])).toBe('');
  });

  it('emits a named import for a single requirement', () => {
    const out = renderImports([{ moduleSpecifier: 'm', symbol: 'a' }]);
    expect(out).toBe("import { a } from 'm';");
  });

  it('aggregates named symbols per module, sorted alphabetically', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'c' },
      { moduleSpecifier: 'm', symbol: 'a' },
      { moduleSpecifier: 'm', symbol: 'b' },
    ]);
    expect(out).toBe("import { a, b, c } from 'm';");
  });

  it('deduplicates repeated named symbols within a module', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'a' },
      { moduleSpecifier: 'm', symbol: 'a' },
    ]);
    expect(out).toBe("import { a } from 'm';");
  });

  it('emits modules in alphabetical order', () => {
    const out = renderImports([
      { moduleSpecifier: 'z', symbol: 'z1' },
      { moduleSpecifier: 'a', symbol: 'a1' },
      { moduleSpecifier: 'm', symbol: 'm1' },
    ]);
    expect(out).toBe(
      ["import { a1 } from 'a';", "import { m1 } from 'm';", "import { z1 } from 'z';"].join('\n'),
    );
  });

  it('emits a default import when kind is "default"', () => {
    const out = renderImports([
      { moduleSpecifier: './contract.json', symbol: 'contract', kind: 'default' },
    ]);
    expect(out).toBe("import contract from './contract.json';");
  });

  it('renders import attributes verbatim in a `with` clause', () => {
    const out = renderImports([
      {
        moduleSpecifier: './contract.json',
        symbol: 'contract',
        kind: 'default',
        attributes: { type: 'json' },
      },
    ]);
    expect(out).toBe('import contract from \'./contract.json\' with { type: "json" };');
  });

  it('combines a default with named imports on the same module into one line', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'a' },
      { moduleSpecifier: 'm', symbol: 'def', kind: 'default' },
      { moduleSpecifier: 'm', symbol: 'b' },
    ]);
    expect(out).toBe("import def, { a, b } from 'm';");
  });

  it('throws when two requirements conflict on the default symbol', () => {
    expect(() =>
      renderImports([
        { moduleSpecifier: 'm', symbol: 'x', kind: 'default' },
        { moduleSpecifier: 'm', symbol: 'y', kind: 'default' },
      ]),
    ).toThrow(/Conflicting default imports/);
  });

  it('permits repeated default requirements with the same symbol', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'x', kind: 'default' },
      { moduleSpecifier: 'm', symbol: 'x', kind: 'default' },
    ]);
    expect(out).toBe("import x from 'm';");
  });

  it('throws when two requirements for the same module disagree on attributes', () => {
    expect(() =>
      renderImports([
        {
          moduleSpecifier: 'm',
          symbol: 'a',
          attributes: { type: 'json' },
        },
        {
          moduleSpecifier: 'm',
          symbol: 'b',
          attributes: { type: 'text' },
        },
      ]),
    ).toThrow(/Conflicting import attributes/);
  });

  it('treats a missing attributes map as distinct from an empty one for conflict purposes', () => {
    expect(() =>
      renderImports([
        { moduleSpecifier: 'm', symbol: 'a', attributes: { type: 'json' } },
        { moduleSpecifier: 'm', symbol: 'b' },
      ]),
    ).toThrow(/Conflicting import attributes/);
  });

  it('merges duplicate (module, symbol) pairs across attribute-agreeing requirements', () => {
    const out = renderImports([
      { moduleSpecifier: './c.json', symbol: 'c', kind: 'default', attributes: { type: 'json' } },
      { moduleSpecifier: './c.json', symbol: 'c', kind: 'default', attributes: { type: 'json' } },
    ]);
    expect(out).toBe('import c from \'./c.json\' with { type: "json" };');
  });
});
