import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { getCompanySettings } from '../lib/api/settings';
import type { CompanySettings } from '../types/settings';

type CompanySettingsContextValue = {
  settings: CompanySettings | null;
  loading: boolean;
  /** Re-fetches settings from the server. */
  refresh: () => Promise<void>;
  /** Updates the settings held in context immediately (e.g. right after a save),
   *  so every screen using them re-renders without waiting on a refetch. */
  setSettings: (settings: CompanySettings) => void;
};

const CompanySettingsContext = createContext<CompanySettingsContextValue | undefined>(undefined);

export function CompanySettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetched unconditionally, including on the login screen before there's a
  // session — company_name / logo_url are branding, not sensitive data, so
  // this relies on your company_settings table allowing SELECT for the
  // "anon" role (or "authenticated" role once signed in). If the fetch
  // fails (e.g. RLS blocks anon reads), settings stays null and screens
  // fall back to their default branding until the user is signed in.
  const refresh = useCallback(async () => {
    try {
      const data = await getCompanySettings();
      setSettingsState(data);
    } catch {
      // Leave whatever was previously loaded in place; individual screens
      // can surface their own error state if they need to.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setSettings = useCallback((data: CompanySettings) => {
    setSettingsState(data);
  }, []);

  return (
    <CompanySettingsContext.Provider value={{ settings, loading, refresh, setSettings }}>
      {children}
    </CompanySettingsContext.Provider>
  );
}

/** Read or update the shared company settings from any screen. */
export function useCompanySettings() {
  const ctx = useContext(CompanySettingsContext);
  if (!ctx) {
    throw new Error('useCompanySettings must be used within a CompanySettingsProvider');
  }
  return ctx;
}