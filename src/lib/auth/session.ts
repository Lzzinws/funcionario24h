import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole, Organization, Plan, Subscription } from "@/lib/types";

export const ACTIVE_ORG_COOKIE = "f24h_org";

/** Usuário autenticado (validado no servidor do Supabase) ou redireciona. */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");
  return { supabase, user };
});

export interface OrgContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  userEmail: string | undefined;
  org: Organization;
  role: MemberRole;
  subscription: Subscription | null;
  plan: Plan | null;
  memberships: { organization_id: string; role: MemberRole; name: string }[];
}

/**
 * Organização ativa do usuário. A escolha vem de um cookie, mas o vínculo é
 * SEMPRE revalidado contra organization_members (via RLS) — o cookie sozinho
 * não concede acesso a nada.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const { supabase, user } = await requireUser();
  const { data: rows, error } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", user.id)
    .order("created_at");
  if (error) throw new Error(`Falha ao carregar organizações: ${error.message}`);
  if (!rows || rows.length === 0) return null;

  const memberships = rows.map((r) => ({
    organization_id: r.organization_id as string,
    role: r.role as MemberRole,
    name: (r.organizations as unknown as { name: string } | null)?.name ?? "",
  }));
  const wanted = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const current = memberships.find((m) => m.organization_id === wanted) ?? memberships[0];

  const [orgRes, subRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", current.organization_id).single(),
    supabase.from("subscriptions").select("*, plans(*)").eq("organization_id", current.organization_id).maybeSingle(),
  ]);
  if (orgRes.error) throw new Error(`Falha ao carregar a organização: ${orgRes.error.message}`);

  const sub = subRes.data as (Subscription & { plans: Plan }) | null;
  return {
    supabase,
    userId: user.id,
    userEmail: user.email,
    org: orgRes.data as Organization,
    role: current.role,
    subscription: sub,
    plan: sub?.plans ?? null,
    memberships,
  };
});

/** Exige organização (senão envia ao onboarding) e, opcionalmente, um papel. */
export async function requireOrg(roles?: MemberRole[]): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/onboarding");
  if (roles && !roles.includes(ctx.role)) {
    throw new AuthorizationError("Seu papel nesta empresa não permite esta ação.");
  }
  return ctx;
}

export class AuthorizationError extends Error {}

export const canManage = (role: MemberRole) => role === "owner" || role === "admin";
