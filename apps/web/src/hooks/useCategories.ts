import { useEffect, useState } from 'react';
import type { Category, TransactionType } from '@finance/shared';
import { api, ApiError } from '../api/client';

export function useCategories(appliesTo?: TransactionType, onError?: (message: string) => void) {
  const [categories, setCategories] = useState<Category[]>([]);

  async function refresh() {
    try {
      const res = await api.listCategories(appliesTo);
      setCategories(res.categories);
    } catch (err) {
      if (err instanceof ApiError) onError?.(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliesTo]);

  return { categories, refresh };
}
