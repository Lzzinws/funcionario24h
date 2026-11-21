import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { canManage, requireOrg } from "@/lib/auth/session";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { KNOWLEDGE_CATEGORIES } from "@/lib/validation/knowledge";
import { cn, formatBRL, formatRelative } from "@/lib/utils";
import type { KnowledgeItem } from "@/lib/types";
import { DeleteKnowledgeButton, KnowledgeSheet } from "./knowledge-editor";

export const metadata: Metadata = { title: "Base de conhecimento" };
const catLabel = Object.fromEntries(KNOWLEDGE_CATEGORIES) as Record<string, string>;

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string; categoria?: string }> }) {
  const { q, categoria } = await searchParams;
  const { supabase, org, role } = await requireOrg();
  const manage = canManage(role);

  let query = supabase.from("knowledge_base").select("*").eq("organization_id", org.id).order("category").order("title").limit(300);
  if (categoria && catLabel[categoria]) query = query.eq("category", categoria);
  const term = q?.trim().slice(0, 100);
  if (term) query = query.textSearch("search", term, { type: "websearch", config: "portuguese" });

  const [{ data, error }, { data: emps }] = await Promise.all([
    query,
    supabase.from("employees").select("id, name").eq("organization_id", org.id).order("created_at"),
  ]);
  if (error) throw new Error(error.message);
  const items = (data ?? []) as KnowledgeItem[];
  const empName = Object.fromEntries((emps ?? []).map((e) => [e.id, e.name]));
  const filtered = !!(term || categoria);

  const filterHref = (c?: string) => {
    const p = new URLSearchParams();
    if (term) p.set("q", term);
    if (c) p.set("categoria", c);
    const s = p.toString();
    return `/conhecimento${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Base de conhecimento"
        description="Tudo o que seus funcionários digitais podem dizer aos clientes. Se não estiver aqui, eles não inventam: transferem para você."
        actions={manage ? <KnowledgeSheet trigger="new" employees={emps ?? []} /> : null} />

      <div className="mb-5 grid gap-3 md:grid-cols-[minmax(0,320px)_1fr] md:items-center">
        <form role="search" className="relative">
          {categoria ? <input type="hidden" name="categoria" value={categoria} /> : null}
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sage" aria-hidden />
          <label htmlFor="q" className="sr-only">Buscar na base</label>
          <Input id="q" name="q" type="search" defaultValue={term} placeholder="Buscar por palavra-chave" className="pl-9" />
        </form>
        <nav aria-label="Categorias" className="flex gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {[["", "Todas"] as const, ...KNOWLEDGE_CATEGORIES].map(([v, l]) => (
            <Link key={v} href={filterHref(v || undefined)} aria-current={(categoria ?? "") === v ? "true" : undefined}
              className={cn("shrink-0 rounded-full px-3 py-1 text-[13px] transition-colors", (categoria ?? "") === v ? "bg-forest text-white" : "text-sage-dark hover:bg-ink/5")}>
              {l}
            </Link>
          ))}
        </nav>
      </div>

      {items.length === 0 ? (
        <Card className="grid place-items-center gap-2 px-6 py-16 text-center">
          <p className="font-display text-lg font-semibold">{filtered ? "Nada encontrado com esses filtros" : "Sua base está vazia"}</p>
          <p className="max-w-md text-sm text-sage-dark">
            {filtered ? "Tente outra palavra ou mostre todas as categorias." : "Comece pelos serviços mais procurados, com preço e o que está incluso. Depois, as perguntas que você mais responde no dia a dia."}
          </p>
          {filtered ? <Link href="/conhecimento" className="mt-2 text-sm font-medium text-forest hover:underline">Limpar filtros</Link> : null}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{i.title}</p>
                    <Badge>{catLabel[i.category]}</Badge>
                    {!i.is_published ? <Badge tone="warning">Oculto</Badge> : null}
                    {i.allowed_employee_ids ? <Badge tone="dark">Só {i.allowed_employee_ids.map((id) => empName[id]).filter(Boolean).join(", ")}</Badge> : null}
                  </div>
                  {i.content ? <p className="mt-1 line-clamp-2 max-w-3xl text-[13px] leading-relaxed text-sage-dark">{i.content}</p> : null}
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  {i.price_cents != null ? <span className="tabular text-sm font-medium">{formatBRL(i.price_cents)}</span> : null}
                  <time className="text-xs text-sage" dateTime={i.updated_at}>{formatRelative(i.updated_at)}</time>
                  {manage ? <span className="flex"><KnowledgeSheet trigger="edit" item={i} employees={emps ?? []} /><DeleteKnowledgeButton id={i.id} title={i.title} /></span> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
