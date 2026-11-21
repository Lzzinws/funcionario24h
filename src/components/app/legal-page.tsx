import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-line px-4 py-4 sm:px-8"><Link href="/"><Logo /></Link></header>
      <article className="mx-auto max-w-2xl px-4 py-12 text-[15px] leading-relaxed text-ink sm:px-8 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-3 [&_li]:mt-1.5 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="rounded-md bg-amber-soft px-4 py-3 text-sm text-amber">Minuta em revisão jurídica. O texto definitivo será publicado antes do lançamento comercial.</p>
        {children}
      </article>
    </div>
  );
}
