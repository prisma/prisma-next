'use client';

import { useState } from 'react';
import { useCart } from './cart-provider';
import { Button } from './ui/button';

interface AddToCartButtonProps {
  product: {
    _id: string;
    name: string;
    brand: string;
    code: string;
    price: { amount: number; currency: string };
  };
}

export function AddToCartButton({ product }: AddToCartButtonProps) {
  const { invalidateCart } = useCart();
  const [state, setState] = useState<'idle' | 'loading' | 'added'>('idle');

  async function handleAdd() {
    setState('loading');
    try {
      await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product._id,
          name: product.name,
          brand: product.brand,
          amount: 1,
          price: product.price,
          image: { url: `/images/products/${product.code.toLowerCase()}.jpg` },
        }),
      });
      invalidateCart();
      setState('added');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('idle');
    }
  }

  return (
    <Button onClick={handleAdd} disabled={state === 'loading'} className="w-full">
      {state === 'loading' ? 'Adding...' : state === 'added' ? 'Added!' : 'Add to Cart'}
    </Button>
  );
}
