import { supabase } from '../supabaseClient';

export interface PanchangamPeriod {
  label: string;
  start: string;
  end: string;
}

export interface PanchangamDay {
  date: string;
  sunrise?: string;
  sunset?: string;
  tithi: string | null;
  nakshatra: string | null;
  goodTimes: PanchangamPeriod[];
  badTimes: PanchangamPeriod[];
}

/**
 * Real-time — every call re-computes today's good/bad muhurat times via the
 * get-panchangam Edge Function. No table, no manual entry, no stale data.
 */
export async function getTodayPanchangam(): Promise<PanchangamDay> {
  const { data, error } = await supabase.functions.invoke<PanchangamDay>('get-panchangam');
  if (error) throw error;
  if (!data) throw new Error('No panchangam data returned.');
  return data;
}