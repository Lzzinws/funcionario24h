import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { isSupabaseConfigured } from "@/lib/env";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-forest p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Link href="/" aria-label="Página inicial"><Logo tone="light" /></Link>
        <div className="max-w-md">
          <p className="font-display text-[40px] font-semibold leading-[1.05] tracking-tight">
            Sua empresa nunca trabalha sozinha.
          </p>
          <p className="mt-5 text-[15px] leading-relaxed text-white/70">
            Atendente, vendedor e agendador digitais respondendo seus clientes no WhatsApp a qualquer hora —
            e pedindo sua aprovação antes de qualquer decisão importante.
          </p>
        </div>
        <ul className="grid gap-3 text-sm text-white/80">
          <li className="flex items-center gap-3"><span className="size-1.5 rounded-full bg-mint" />Responde em segundos, de madrugada ou no feriado</li>
          <li className="flex items-center gap-3"><span className="size-1.5 rounded-full bg-mint" />Descontos, pagamentos e confirmações passam por você</li>
          <li className="flex items-center gap-3"><span className="size-1.5 rounded-full bg-mint" />Dados da sua empresa isolados e protegidos (LGPD)</li>
        </ul>
        <svg aria-hidden viewBox="0 0 400 400" className="pointer-events-none absolute -bottom-56 -right-56 size-[520px] opacity-[0.12]">
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i / 24) * Math.PI * 2;
            return <line key={i} x1={200 + Math.sin(a) * 150} y1={200 - Math.cos(a) * 150} x2={200 + Math.sin(a) * 190} y2={200 - Math.cos(a) * 190} stroke="#65D69B" strokeWidth={i % 6 === 0 ? 6 : 2} strokeLinecap="round" />;
          })}
        </svg>
      </aside>
      <main className="flex flex-col px-4 py-8 sm:px-10">
        <Link href="/" className="lg:hidden" aria-label="Página inicial"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {!isSupabaseConfigured() ? (
            <p role="status" className="mb-6 rounded-md bg-amber-soft px-3 py-2 text-[13px] text-amber">
              A plataforma está em configuração. Cadastro e login serão liberados assim que o banco de dados for conectado.
            </p>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
