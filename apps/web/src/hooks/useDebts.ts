import { useEffect, useState } from 'react';
import type { Debt } from '@finance/shared';
import { api, ApiError } from '../api/client';

export function useDebts(onError?: (message: string) => void) {
  const [debts, setDebts] = useState<Debt[]>([]);

  async function refresh() {
    try {
      const res = await api.listDebts();
      setDebts(res.debts);
    } catch (err) {
      if (err instanceof ApiError) onError?.(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return { debts, refresh };
}
