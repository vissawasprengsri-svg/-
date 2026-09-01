import { useEffect, useRef, useState } from 'react';
import type { Debt } from '@finance/shared';
import { api, ApiError } from '../api/client';

export function useDebts(onError?: (message: string) => void) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const latestRequestId = useRef(0);

  async function refresh() {
    const requestId = ++latestRequestId.current;
    try {
      const res = await api.listDebts();
      // A slower earlier request can resolve after a newer one — ignore it
      // so it can't clobber fresher state.
      if (requestId === latestRequestId.current) setDebts(res.debts);
    } catch (err) {
      if (requestId === latestRequestId.current && err instanceof ApiError) onError?.(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return { debts, refresh };
}
