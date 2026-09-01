import { useEffect, useState } from 'react';
import type { AccountWithCard } from '@finance/shared';
import { api, ApiError } from '../api/client';

export function useAccounts(onError?: (message: string) => void) {
  const [accounts, setAccounts] = useState<AccountWithCard[]>([]);

  async function refresh() {
    try {
      const res = await api.listAccounts();
      setAccounts(res.accounts);
    } catch (err) {
      if (err instanceof ApiError) onError?.(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return { accounts, refresh };
}
