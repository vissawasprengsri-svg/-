import { useEffect, useRef, useState } from 'react';
import type { Category, TransactionType } from '@finance/shared';
import { api, ApiError } from '../api/client';

export function useCategories(appliesTo?: TransactionType, onError?: (message: string) => void) {
  const [categories, setCategories] = useState<Category[]>([]);
  const latestRequestId = useRef(0);

  async function refresh() {
    const requestId = ++latestRequestId.current;
    try {
      const res = await api.listCategories(appliesTo);
      // A slower earlier request can resolve after a newer one — ignore it
      // so it can't clobber fresher state (e.g. right after a rename).
      if (requestId === latestRequestId.current) setCategories(res.categories);
    } catch (err) {
      if (requestId === latestRequestId.current && err instanceof ApiError) onError?.(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliesTo]);

  return { categories, refresh };
}
