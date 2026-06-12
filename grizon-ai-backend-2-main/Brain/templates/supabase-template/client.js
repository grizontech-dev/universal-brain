import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';

export const supabase = url && key ? createClient(url, key) : null;

export async function pingSupabase() {
  if (!supabase) return { connected: false, reason: 'missing env' };
  const { error } = await supabase.from('_health').select('*').limit(1);
  return { connected: !error, error: error?.message };
}
