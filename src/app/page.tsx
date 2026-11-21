import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import type { Plan } from "@/lib/types";

const TEAM = [
  { role: "Atendente", does: ["Responde dúvidas com as informações da sua empresa", "Entende o que o cliente precisa", "Chama você quando não sabe"] },
  { role: "Vendedor", does: ["Qualifica o interesse e registra no CRM", "Apresenta produtos com preços autorizados", "Pede sua aprovação para qualquer desconto"] },
  { role: "Agendador", does: ["Consulta horários disponíveis", "Prepara o agendamento completo", "Confirma só depois do seu ok"] },
];

export default async function Home() {
  let plans: Plan[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("plans").select("*").eq("is_active", true).order("sort_order");
    plans = (data ?? []) as Plan[];
  } catch { /* sem configuração: seção de planos não é exibida */ }

  return (
    <div className="bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm"><Link href="/entrar">Entrar</Link></Button>
          <Button asChild size="sm"><Link href="/cadastrar">Testar 7 dias</Link></Button>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-12 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-20">
        <div>
          <h1 className="font-display text-[44px] font-semibold leading-[1.02] tracking-tight sm:text-[64px]">
            Sua empresa nunca trabalha sozinha.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-sage-dark">
            Contrate funcionários digitais que atendem, vendem e agendam pelo WhatsApp a qualquer hora — e deixam as decisões importantes com você.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/cadastrar">Montar minha equipe</Link></Button>
            <Button asChild size="lg" variant="outline"><a href="#planos">Ver planos</a></Button>
          </div>
        </div>
        <div className="rounded-2xl bg-forest p-6 text-white sm:p-8">
          <p className="text-sm text-white/60">23h47 · WhatsApp</p>
          <div className="mt-4 grid gap-3 text-[15px]">
            <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/10 px-4 py-2.5">Oi! Vocês fazem clareamento? Quanto custa?</p>
            <p className="max-w-[85%] justify-self-end rounded-2xl rounded-tr-sm bg-mint px-4 py-2.5 text-ink">Fazemos sim! O clareamento a laser custa R$ 890 e leva cerca de 1h. Quer que eu veja um horário para você?</p>
            <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/10 px-4 py-2.5">Quero, sábado de manhã. Tem desconto à vista?</p>
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-lg bg-forest-deep px-4 py-3 text-[13px] text-white/80">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden />
            Desconto e agendamento enviados para sua aprovação. O cliente foi avisado de que a confirmação chega em seguida.
          </div>
        </div>
      </section>

      <section className="bg-paper py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight">Uma equipe com funções claras</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {TEAM.map((m) => (
              <div key={m.role}>
                <h3 className="font-display text-xl font-semibold">{m.role}</h3>
                <ul className="mt-3 grid gap-2 text-[15px] text-sage-dark">
                  {m.does.map((d) => <li key={d} className="flex gap-2.5"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-mint" />{d}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {plans.length ? (
        <section id="planos" className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Planos</h2>
          <p className="mt-2 text-sage-dark">7 dias de teste em qualquer plano.</p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {plans.map((p, i) => (
              <div key={p.id} className={`rounded-xl border p-6 ${i === 1 ? "border-forest" : "border-line"}`}>
                <h3 className="font-display text-xl font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-sage-dark">{p.description}</p>
                <p className="tabular mt-5 font-display text-3xl font-semibold">{formatBRL(p.price_cents)}<span className="text-base font-normal text-sage-dark">/mês</span></p>
                <p className="mt-4 text-sm">Até {p.max_employees} funcionário{p.max_employees > 1 ? "s" : ""} · {p.max_whatsapp_numbers} WhatsApp</p>
                <Button asChild className="mt-6 w-full" variant={i === 1 ? "primary" : "outline"}><Link href="/cadastrar">Começar com {p.name}</Link></Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-4 py-8 text-sm text-sage-dark sm:px-8">
          <span>© {new Date().getFullYear()} Funcionário 24h</span>
          <span className="flex gap-4"><Link href="/termos" className="hover:text-ink">Termos de uso</Link><Link href="/privacidade" className="hover:text-ink">Privacidade</Link></span>
        </div>
      </footer>
    </div>
  );
}
