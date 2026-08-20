import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : '') ||
  'https://kknwnvtqmyncaotbrryv.supabase.co';

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : '') ||
  'sb_publishable_Wl5rWwaVSzdrWeg0Y4Rr_A_AqP_bLV-';

export const createClient = () =>
  createBrowserClient(
    supabaseUrl,
    supabaseKey
  );
