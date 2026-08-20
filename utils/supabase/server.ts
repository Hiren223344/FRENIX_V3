import { createServerClient } from "@supabase/ssr";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://kknwnvtqmyncaotbrryv.supabase.co';

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_Wl5rWwaVSzdrWeg0Y4Rr_A_AqP_bLV-';

export const createClient = (cookieStore?: {
  getAll: () => Array<{ name: string; value: string }>;
  set?: (name: string, value: string, options?: any) => void;
}) => {
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return cookieStore ? cookieStore.getAll() : [];
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          try {
            if (cookieStore?.set) {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set!(name, value, options)
              );
            }
          } catch {
            // Ignored if called where cookies cannot be mutated
          }
        },
      },
    }
  );
};
