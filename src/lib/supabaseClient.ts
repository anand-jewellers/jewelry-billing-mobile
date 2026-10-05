// src\lib\supabaseClient.ts

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env and fill in ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY from ' +
      'Project Settings > API. Restart the dev server after editing .env.'
  );
}

// @react-native-async-storage/async-storage ships a web shim that falls
// back to localStorage, but it has been an unreliable source of session
// persistence issues on Expo web (session appears to exist client-side but
// doesn't get attached correctly to outgoing requests, which shows up as
// RLS policies rejecting an otherwise-correctly-privileged user). Use a
// direct localStorage-backed adapter on web instead, guarded so it doesn't
// throw during SSR/build where `window` isn't defined.
const webStorage = {
  getItem: (key: string) => {
    if (typeof window === 'undefined') return Promise.resolve(null);
    return Promise.resolve(window.localStorage.getItem(key));
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return Promise.resolve();
    window.localStorage.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return Promise.resolve();
    window.localStorage.removeItem(key);
    return Promise.resolve();
  },
};

const authStorage = Platform.OS === 'web' ? webStorage : AsyncStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    // RN has no URL bar for magic links / OAuth redirects to land in,
    // but on web, if you ever add magic-link/OAuth flows, Supabase needs
    // to read the token out of the URL on redirect.
    detectSessionInUrl: Platform.OS === 'web',
  },
});