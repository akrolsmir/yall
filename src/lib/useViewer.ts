'use client';

import { db } from '@/lib/db';

// Auth state plus the viewer's own $users row (perms restrict $users view to
// self, so this query returns at most one row).
export function useViewer() {
  const { isLoading: authLoading, user } = db.useAuth();
  const { data, isLoading: userLoading } = db.useQuery(
    user ? { $users: {} } : null,
  );
  const me = data?.$users?.[0] ?? null;
  return {
    isLoading: authLoading || (!!user && userLoading),
    user,
    me,
    isAdmin: me?.isAdmin === true,
  };
}
