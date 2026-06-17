import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

function field(typeText: string): string {
  return format(`model M {\nf ${typeText}\n}`);
}

function fieldLine(typeText: string): string {
  return `  f ${typeText}`;
}

describe('format type-annotation round-trip', () => {
  it('round-trips a plain type', () => {
    expect(field('String')).toContain(fieldLine('String'));
  });

  it('round-trips a list type', () => {
    expect(field('String[]')).toContain(fieldLine('String[]'));
  });

  it('round-trips an optional type', () => {
    expect(field('String?')).toContain(fieldLine('String?'));
  });

  it('round-trips an optional list type', () => {
    expect(field('String[]?')).toContain(fieldLine('String[]?'));
  });

  it('round-trips a space-qualified type', () => {
    expect(field('space:Type')).toContain(fieldLine('space:Type'));
  });

  it('round-trips a namespace-qualified type', () => {
    expect(field('ns.Type')).toContain(fieldLine('ns.Type'));
  });

  it('round-trips a space-and-namespace-qualified type', () => {
    expect(field('supabase:auth.AuthUser')).toContain(fieldLine('supabase:auth.AuthUser'));
  });

  it('round-trips a constructor-call type', () => {
    expect(field('Vector(1536)')).toContain(fieldLine('Vector(1536)'));
  });

  it('round-trips a list constructor-call type', () => {
    expect(field('Vector(1536)[]')).toContain(fieldLine('Vector(1536)[]'));
  });

  it('round-trips a named type declaration annotation', () => {
    const out = format('types {\nVec = Vector(1536)[]?\n}');
    expect(out).toContain('  Vec = Vector(1536)[]?');
  });
});
