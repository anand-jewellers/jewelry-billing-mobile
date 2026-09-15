// src/context/NotificationContext.tsx
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useStaff } from './StaffContext';
import { useCompanySettings } from './CompanySettingsContext';

type NotificationType = 'product' | 'invoice' | 'settings';

export type AppNotification = {
  id: string;
  company_id: number; // company_settings.id is an integer, not a uuid
  type: NotificationType;
  title: string;
  message: string;
  created_by: string | null;
  created_at: string;
};

type NotificationContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  clearOne: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  notify: (type: NotificationType, title: string, message: string) => Promise<void>;
};

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { currentStaff } = useStaff();
  const { settings } = useCompanySettings();
  const companyId = settings?.id; // number
  const staffId = currentStaff?.id;

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const loadDismissals = useCallback(async () => {
    if (!staffId) return new Set<string>();
    const { data, error } = await supabase
      .from('notification_dismissals')
      .select('notification_id')
      .eq('staff_id', staffId);
    if (error) {
      console.warn('Failed to load dismissals', error);
      return new Set<string>();
    }
    return new Set((data ?? []).map((d) => d.notification_id as string));
  }, [staffId]);

  const loadNotifications = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [{ data, error }, dismissed] = await Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(100),
      loadDismissals(),
    ]);
    if (error) console.warn('Failed to load notifications', error);
    setNotifications((data ?? []) as AppNotification[]);
    setDismissedIds(dismissed);
    setLoading(false);
  }, [companyId, loadDismissals]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Live updates: new events push straight into the list
  useEffect(() => {
    if (!companyId) return;

    channelRef.current = supabase
      .channel(`notifications-${companyId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `company_id=eq.${companyId}` },
        (payload) => {
          setNotifications((prev) => [payload.new as AppNotification, ...prev]);
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [companyId]);

  const clearOne = useCallback(
    async (id: string) => {
      if (!staffId) return;
      setDismissedIds((prev) => new Set(prev).add(id)); // optimistic
      const { error } = await supabase
        .from('notification_dismissals')
        .insert({ notification_id: id, staff_id: staffId });
      if (error && error.code !== '23505') {
        console.warn('Failed to clear notification', error);
      }
    },
    [staffId]
  );

  const clearAll = useCallback(async () => {
    if (!staffId) return;
    const idsToClear = notifications.map((n) => n.id).filter((id) => !dismissedIds.has(id));
    if (idsToClear.length === 0) return;

    setDismissedIds((prev) => {
      const next = new Set(prev);
      idsToClear.forEach((id) => next.add(id));
      return next;
    });

    const rows = idsToClear.map((id) => ({ notification_id: id, staff_id: staffId }));
    const { error } = await supabase
      .from('notification_dismissals')
      .upsert(rows, { onConflict: 'notification_id,staff_id' });
    if (error) console.warn('Failed to clear all notifications', error);
  }, [notifications, dismissedIds, staffId]);

  const notify = useCallback(
    async (type: NotificationType, title: string, message: string) => {
      if (!companyId) return;
      const { error } = await supabase
        .from('notifications')
        .insert({ company_id: companyId, type, title, message, created_by: staffId ?? null });
      if (error) console.warn('Failed to create notification', error);
    },
    [companyId, staffId]
  );

  const visible = notifications.filter((n) => !dismissedIds.has(n.id));

  return (
    <NotificationContext.Provider
      value={{ notifications: visible, unreadCount: visible.length, loading, clearOne, clearAll, notify }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}