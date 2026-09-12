// src/context/StaffContext.tsx
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
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

export function StaffProvider({ children }: { children: ReactNode }) {
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const loadPermissions = useCallback(async (staffId: string) => {
    const { data } = await supabase
      .from('staff_permissions')
      .select('page_key, can_access')
      .eq('staff_id', staffId);
    const map: Record<string, boolean> = {};
    (data ?? []).forEach((row: any) => {
      map[row.page_key] = row.can_access;
    });
    setPermissions(map);
  }, []);

  const restoreSession = useCallback(async () => {
    setLoading(true);
    try {
      const savedId = await storage.getItem(STAFF_SESSION_KEY);
      if (savedId) {
        const { data, error } = await supabase
          .from('staff')
          .select('id, name, phone, email, role, is_active, created_at')
          .eq('id', savedId)
          .eq('is_active', true)
          .maybeSingle();
        if (data && !error) {
          setCurrentStaff(data as Staff);
          await loadPermissions(data.id);
        } else {
          await storage.deleteItem(STAFF_SESSION_KEY);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [loadPermissions]);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const refreshStaffList = useCallback(async () => {
    await restoreSession();
  }, [restoreSession]);

  const loginStaff = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.rpc('verify_staff_login', {
        p_email: email,
        p_password: password,
      });
      if (error || !data || data.length === 0) {
        return { ok: false, error: 'Incorrect email or password' };
      }
      const staffRow = data[0];
      setCurrentStaff(staffRow as Staff);
      await loadPermissions(staffRow.id);
      await storage.setItem(STAFF_SESSION_KEY, staffRow.id);
      return { ok: true };
    },
    [loadPermissions]
  );

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

  return (
    <StaffContext.Provider
      value={{ currentStaff, permissions, loading, refreshStaffList, loginStaff, logoutStaff, hasAccess }}
    >
      {children}
    </StaffContext.Provider>
  );
}

export function useStaff() {
  const ctx = useContext(StaffContext);
  if (!ctx) throw new Error('useStaff must be used within StaffProvider');
  return ctx;
}