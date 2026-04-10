import { findProducts } from '../src/data/products';
import { getDb } from '../src/db-singleton';

export const dynamic = 'force-dynamic';

export default async function ProductCatalog() {
  const db = await getDb();
  const products = await findProducts(db);

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Product Catalog</h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {products.map((product) => (
          <a
            key={String(product._id)}
            href={`/products/${String(product._id)}`}
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '1.25rem',
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'box-shadow 0.2s',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>
              {product.brand}
            </div>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{product.name}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
              {product.articleType} · {product.subCategory}
            </div>
            <div style={{ fontWeight: 700, color: 'var(--accent)' }}>
              ${Number(product.price.amount).toFixed(2)} {product.price.currency}
            </div>
          </a>
        ))}
      </div>
      {products.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>No products found. Run the seed script first.</p>
      )}
    </div>
  );
}
