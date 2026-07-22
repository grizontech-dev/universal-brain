import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!url || !key) {
  console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY — client disabled');
}

export const supabase = url && key ? createClient(url, key) : null;

export async function pingSupabase() {
  if (!supabase) return { connected: false, reason: 'missing env vars' };
  try {
    const { error } = await supabase.from('todos').select('id').limit(1);
    return { connected: !error, error: error?.message };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}
