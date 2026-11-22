import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { canManage, requireOrg } from "@/lib/auth/session";
import { aiTestReadiness } from "@/lib/ai/readiness";
import { AI_CONFIG } from "@/lib/ai/config";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TestChat, type ChatMessage } from "./test-chat";

export const metadata: Metadata = { title: "Testar funcionário" };
export const maxDuration = 60;

export default async function TestEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, org, role } = await requireOrg();
  const { data: emp } = await supabase.from("employees").select("id, name, title, is_active").eq("id", id).eq("organization_id", org.id).maybeSingle();
  if (!emp) notFound();

  const { data: conv } = await supabase.from("conversations").select("id")
    .eq("organization_id", org.id).eq("employee_id", id).eq("channel", "teste").neq("status", "closed")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: msgs } = conv
    ? await supabase.from("messages").select("id, direction, sender_type, content, created_at").eq("conversation_id", conv.id).order("created_at").limit(200)
    : { data: [] };

  const ready = aiTestReadiness();
  const disabled = !canManage(role) ? "Somente proprietários e administradores podem testar."
    : !ready.ok ? "Teste indisponível até concluir a configuração ao lado." : undefined;

  return (
    <>
      <Link href={`/funcionarios/${id}`} className="mb-4 inline-flex items-center gap-1 text-[13px] text-sage-dark hover:text-ink"><ChevronLeft className="size-4" aria-hidden />{emp.name}</Link>
      <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">Testar {emp.name}</h1>
      <p className="mb-6 mt-1 max-w-2xl text-[15px] text-sage-dark">
        Veja como {emp.name} responde antes de colocar no WhatsApp. {emp.is_active ? "" : "Funciona mesmo com o funcionário pausado."}
      </p>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <TestChat employeeId={id} employeeName={emp.name} initial={(msgs ?? []) as ChatMessage[]} disabled={disabled} />
        <div className="grid content-start gap-6">
          {!ready.ok ? (
            <Card className="border-amber/40">
              <CardHeader title="Configuração pendente" description="Adicione no Vercel (Settings → Environment Variables) e faça um novo deploy:" />
              <CardBody>
                <ul className="grid gap-2 text-[13px]">
                  {ready.missing.map((k) => <li key={k}><code className="rounded bg-ink/5 px-1.5 py-0.5">{k}</code></li>)}
                </ul>
                <p className="mt-3 text-xs text-sage-dark">As chaves ficam apenas no servidor e nunca são enviadas ao navegador.</p>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Como o teste funciona" />
            <CardBody className="grid gap-2 text-[13px] leading-relaxed text-sage-dark">
              <p>É o mesmo atendimento do WhatsApp: instruções, base de conhecimento, permissões e aprovações reais.</p>
              <p>Oportunidades criadas aqui ficam marcadas como teste e não entram nos indicadores. O consumo de IA conta na franquia do plano.</p>
              <p className="tabular">Modelo: {AI_CONFIG.model}</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
