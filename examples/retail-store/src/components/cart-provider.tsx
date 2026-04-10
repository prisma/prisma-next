'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

interface CartContextValue {
  count: number;
  invalidateCart: () => void;
}

const CartContext = createContext<CartContextValue>({ count: 0, invalidateCart: () => {} });

export function useCart() {
  return useContext(CartContext);
}

function fetchCount(setCount: (n: number) => void) {
  fetch('/api/cart/count')
    .then((res) => res.json())
    .then((data: { count: number }) => setCount(data.count))
    .catch(() => {});
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(() => {
    if (typeof window !== 'undefined') {
      fetchCount(setCount);
    }
    return 0;
  });

  const invalidateCart = useCallback(() => {
    fetchCount(setCount);
  }, []);

  return <CartContext value={{ count, invalidateCart }}>{children}</CartContext>;
}
