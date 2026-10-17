import { useQuery } from '@tanstack/react-query';
import type { AuthConfig } from '@omni/shared';
import { api } from './client';

/** Публичные настройки сервера: работает ли почта, демо ли это. */
export function useAuthConfig() {
  return useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<AuthConfig>('/auth/config'), staleTime: Infinity });
}
