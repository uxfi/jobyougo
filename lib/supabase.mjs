import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url  = process.env.SUPABASE_URL  || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const enabled = process.env.USE_SUPABASE === 'true';

if (enabled && (!url || !key)) {
  throw new Error('Supabase is enabled but SUPABASE_URL / SUPABASE_ANON_KEY are missing in .env');
}

// Singleton — re-used across scripts that import this module
export const supabase = enabled ? createClient(url, key) : null;

/**
 * Returns true if Supabase is configured and enabled.
 * Use this to guard sync operations without crashing when disabled.
 */
export const isEnabled = enabled;
