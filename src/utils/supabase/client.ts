import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : '') ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://kknwnvtqmyncaotbrryv.supabase.co';

const supabaseKey =
  (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : '') ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_Wl5rWwaVSzdrWeg0Y4Rr_A_AqP_bLV-';

export const createClient = () =>
  createBrowserClient(
    supabaseUrl,
    supabaseKey
  );
