"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Client do navegador: usa apenas a chave pública (anon). RLS protege os dados. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
