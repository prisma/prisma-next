import { notFound } from 'next/navigation';
import { findProductById } from '../../../src/data/products';
import { getDb } from '../../../src/db-singleton';

export const dynamic = 'force-dynamic';

export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const product = await findProductById(db, id);

  if (!product) {
    notFound();
  }

  return (
    <div style={{ maxWidth: '600px' }}>
      <a href="/" style={{ fontSize: '0.85rem', marginBottom: '1rem', display: 'inline-block' }}>
        ← Back to catalog
      </a>
      <div
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '2rem',
        }}
      >
        <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{product.brand}</div>
        <h1 style={{ fontSize: '1.5rem', margin: '0.25rem 0 0.75rem' }}>{product.name}</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>{product.description}</p>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
          <span
            style={{
              background: '#f0f0f0',
              padding: '0.25rem 0.75rem',
              borderRadius: '4px',
            }}
          >
            {product.masterCategory}
          </span>
          <span
            style={{
              background: '#f0f0f0',
              padding: '0.25rem 0.75rem',
              borderRadius: '4px',
            }}
          >
            {product.subCategory}
          </span>
          <span
            style={{
              background: '#f0f0f0',
              padding: '0.25rem 0.75rem',
              borderRadius: '4px',
            }}
          >
            {product.articleType}
          </span>
        </div>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>
          ${Number(product.price.amount).toFixed(2)} {product.price.currency}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '1rem' }}>
          Code: {product.code}
        </div>
      </div>
    </div>
  );
}
