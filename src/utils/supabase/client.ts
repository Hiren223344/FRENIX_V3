import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const supabaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : '') ||
  'https://kknwnvtqmyncaotbrryv.supabase.co';

const supabaseKey =
  (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : '') ||
  'sb_publishable_Wl5rWwaVSzdrWeg0Y4Rr_A_AqP_bLV-';

export const createClient = () =>
  createSupabaseClient(
    supabaseUrl,
    supabaseKey
  );
