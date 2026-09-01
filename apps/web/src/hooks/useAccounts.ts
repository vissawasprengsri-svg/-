import { useEffect, useRef, useState } from 'react';
import type { AccountWithCard } from '@finance/shared';
import { api, ApiError } from '../api/client';

export function useAccounts(onError?: (message: string) => void) {
  const [accounts, setAccounts] = useState<AccountWithCard[]>([]);
  const latestRequestId = useRef(0);

  async function refresh() {
    const requestId = ++latestRequestId.current;
    try {
      const res = await api.listAccounts();
      // A slower earlier request can resolve after a newer one — ignore it
      // so it can't clobber fresher state.
      if (requestId === latestRequestId.current) setAccounts(res.accounts);
    } catch (err) {
      if (requestId === latestRequestId.current && err instanceof ApiError) onError?.(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return { accounts, refresh };
}
