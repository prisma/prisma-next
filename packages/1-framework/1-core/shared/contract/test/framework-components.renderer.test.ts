import { describe, expect, it } from 'vitest';
import { interpolateTypeTemplate, normalizeRenderer } from '../src/framework-components';

describe('interpolateTypeTemplate', () => {
  it('replaces placeholders with params values', () => {
    const result = interpolateTypeTemplate(
      'Vector<{{length}}>',
      { length: 1536 },
      { codecTypesName: 'CodecTypes' },
    );
    expect(result).toBe('Vector<1536>');
  });

  it('replaces multiple placeholders', () => {
    const result = interpolateTypeTemplate(
      'Decimal<{{precision}}, {{scale}}>',
      { precision: 10, scale: 2 },
      { codecTypesName: 'CodecTypes' },
    );
    expect(result).toBe('Decimal<10, 2>');
  });

  it('replaces {{CodecTypes}} with context codecTypesName', () => {
    const result = interpolateTypeTemplate(
      "{{CodecTypes}}['pg/vector@1']['output']",
      {},
      { codecTypesName: 'MyCodecTypes' },
    );
    expect(result).toBe("MyCodecTypes['pg/vector@1']['output']");
  });

  it('combines CodecTypes and params placeholders', () => {
    const result = interpolateTypeTemplate(
      "{{CodecTypes}}['test@1']['output'] & { length: {{length}} }",
      { length: 256 },
      { codecTypesName: 'CodecTypes' },
    );
    expect(result).toBe("CodecTypes['test@1']['output'] & { length: 256 }");
  });

  it('throws for missing placeholder key', () => {
    expect(() =>
      interpolateTypeTemplate('Vector<{{length}}>', {}, { codecTypesName: 'CodecTypes' }),
    ).toThrow(/Missing template parameter "length"/);
  });

  it('throws with helpful error including template and available params', () => {
    expect(() =>
      interpolateTypeTemplate(
        'Vector<{{length}}>',
        { precision: 10 },
        { codecTypesName: 'CodecTypes' },
      ),
    ).toThrow(/template "Vector<\{\{length\}\}>"/);
  });

  it('converts non-string values to strings', () => {
    const result = interpolateTypeTemplate(
      'Value<{{num}}, {{bool}}>',
      { num: 42, bool: true },
      { codecTypesName: 'CodecTypes' },
    );
    expect(result).toBe('Value<42, true>');
  });
});

describe('normalizeRenderer', () => {
  it('normalizes template renderer to function form', () => {
    const renderer = normalizeRenderer('test@1', {
      kind: 'template',
      template: 'Vector<{{length}}>',
    });

    expect(renderer.codecId).toBe('test@1');
    expect(renderer.render({ length: 1536 }, { codecTypesName: 'CodecTypes' })).toBe(
      'Vector<1536>',
    );
  });

  it('passes through function renderer', () => {
    const renderFn = (params: Record<string, unknown>, ctx: { codecTypesName: string }) =>
      `Custom<${params['value']}, ${ctx.codecTypesName}>`;

    const renderer = normalizeRenderer('test@1', {
      kind: 'function',
      render: renderFn,
    });

    expect(renderer.codecId).toBe('test@1');
    expect(renderer.render({ value: 42 }, { codecTypesName: 'CodecTypes' })).toBe(
      'Custom<42, CodecTypes>',
    );
  });

  it('template renderer uses CodecTypes placeholder', () => {
    const renderer = normalizeRenderer('test@1', {
      kind: 'template',
      template: "{{CodecTypes}}['test@1']['output']",
    });

    expect(renderer.render({}, { codecTypesName: 'MyTypes' })).toBe("MyTypes['test@1']['output']");
  });
});
