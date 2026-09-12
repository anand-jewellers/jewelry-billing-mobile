import { supabase } from './supabaseClient';

export type UserRole = 'admin' | 'manager' | 'billing_staff';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
}

/** Sign in with email + password. Throws on failure. */
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Sign the current user out. */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Send a password reset email. The link opens the app via deep link
 * (jewelrybilling://reset-password), handled by expo-router automatically
 * since app.json's "scheme" matches. Configure this exact redirect URL
 * in Supabase Dashboard > Authentication > URL Configuration as well.
 */
export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'jewelrybilling://reset-password',
  });
  if (error) throw error;
}

/** Set a new password for the currently active (recovery) session. */
export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Fetch the profile row (name/role/etc.) for the currently signed-in user. */
export async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, is_active')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data as Profile;
}

export function isAdmin(role: UserRole | undefined) {
  return role === 'admin';
}

export function isAdminOrManager(role: UserRole | undefined) {
  return role === 'admin' || role === 'manager';
}
