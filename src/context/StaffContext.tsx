// src/context/StaffContext.tsx
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { storage } from '../lib/crossPlatformStorage';
import { supabase } from '../lib/supabaseClient';
import type { Staff, PageKey } from '../types/settings';

const STAFF_SESSION_KEY = 'active_staff_id';

interface StaffContextValue {
  currentStaff: Staff | null;
  permissions: Record<string, boolean>;
  loading: boolean;
  refreshStaffList: () => Promise<void>;
  loginStaff: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logoutStaff: () => Promise<void>;
  hasAccess: (pageKey: PageKey) => boolean;
}

const StaffContext = createContext<StaffContextValue | undefined>(undefined);

async function fetchPermissions(staffId: string): Promise<Record<string, boolean>> {
  const { data } = await supabase
    .from('staff_permissions')
    .select('page_key, can_access')
    .eq('staff_id', staffId);
  const map: Record<string, boolean> = {};
  (data ?? []).forEach((row: any) => {
    map[row.page_key] = row.can_access;
  });
  return map;
}

// Keep the previous object when nothing changed, so a background refresh
// doesn't trigger a re-render of every screen that uses useStaff().
function keepIfEqual<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

export function StaffProvider({ children }: { children: ReactNode }) {
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // `silent` = background refresh. It must NOT flip `loading`, because
  // RouteGuard swaps the whole app for a spinner while loading is true,
  // which would unmount every screen.
  const restoreSession = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const savedId = await storage.getItem(STAFF_SESSION_KEY);
      if (!savedId) return;

      const [staffRes, perms] = await Promise.all([
        supabase
          .from('staff')
          .select('id, name, phone, email, role, is_active, created_at')
          .eq('id', savedId)
          .eq('is_active', true)
          .maybeSingle(),
        fetchPermissions(savedId),
      ]);

      // Network/server error: keep the saved session so a bad connection
      // doesn't log the user out.
      if (staffRes.error) return;

      if (staffRes.data) {
        setCurrentStaff((prev) => keepIfEqual(prev, staffRes.data as Staff));
        setPermissions((prev) => keepIfEqual(prev, perms));
      } else {
        setCurrentStaff(null);
        setPermissions({});
        await storage.deleteItem(STAFF_SESSION_KEY);
      }
    } catch (e) {
      console.warn('[StaffContext] restoreSession failed', e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const refreshStaffList = useCallback(async () => {
    await restoreSession(true);
  }, [restoreSession]);

  const loginStaff = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.rpc('verify_staff_login', {
      p_email: email,
      p_password: password,
    });
    if (error || !data || data.length === 0) {
      return { ok: false, error: 'Incorrect email or password' };
    }
    const staffRow = data[0];
    const perms = await fetchPermissions(staffRow.id);
    // Permissions first, so the app never renders with a staff but no access map.
    setPermissions(perms);
    setCurrentStaff(staffRow as Staff);
    await storage.setItem(STAFF_SESSION_KEY, staffRow.id);
    return { ok: true };
  }, []);

  const logoutStaff = useCallback(async () => {
    setCurrentStaff(null);
    setPermissions({});
    await storage.deleteItem(STAFF_SESSION_KEY);
  }, []);

  const hasAccess = useCallback(
    (pageKey: PageKey) => {
      if (!currentStaff) return false;
      if (currentStaff.role === 'admin' || currentStaff.role === 'manager') return true;
      return permissions[pageKey] === true;
    },
    [currentStaff, permissions]
  );

  // Memoized so consumers only re-render when something actually changed.
  const value = useMemo<StaffContextValue>(
    () => ({
      currentStaff,
      permissions,
      loading,
      refreshStaffList,
      loginStaff,
      logoutStaff,
      hasAccess,
    }),
    [currentStaff, permissions, loading, refreshStaffList, loginStaff, logoutStaff, hasAccess]
  );

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

export function useStaff() {
  const ctx = useContext(StaffContext);
  if (!ctx) throw new Error('useStaff must be used within StaffProvider');
  return ctx;
}