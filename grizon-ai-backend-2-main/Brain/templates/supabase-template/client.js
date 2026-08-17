require('dotenv').config();
const supabaseLib = require('@supabase/supabase-js');
const createClient = supabaseLib.createClient || supabaseLib;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
try {
  if (url && key) {
    supabase = createClient(url, key);
    console.log('[Supabase] Client initialized ✓');
  } else {
    console.warn('[Supabase] Missing SUPABASE_URL or key — client disabled');
  }
} catch (e) {
  console.warn('[Supabase] Client init failed:', e.message);
}

module.exports = supabase;
