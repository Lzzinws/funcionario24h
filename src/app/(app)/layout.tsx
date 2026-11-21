import { requireOrg } from "@/lib/auth/session";
import { Sidebar } from "@/components/app/sidebar";
import { signOut } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  const { count } = await ctx.supabase.from("employees").select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.org.id).eq("is_active", true);

  return (
    <div className="min-h-dvh">
      <Sidebar orgName={ctx.org.name} planName={ctx.plan?.name ?? null} userEmail={ctx.userEmail} onDuty={count ?? 0} signOut={signOut} />
      <div className="lg:pl-64">
        {ctx.org.status === "suspended" ? (
          <div role="alert" className="bg-danger-soft px-4 py-3 text-sm text-danger sm:px-8">
            Esta conta está suspensa{ctx.org.suspended_reason ? `: ${ctx.org.suspended_reason}` : ""}. Os funcionários digitais estão pausados. Fale com o suporte para reativar.
          </div>
        ) : null}
        <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
