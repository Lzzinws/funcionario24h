import { cn } from "@/lib/utils";

/** Marca: relógio de 24 marcações com um ponteiro — o turno que nunca acaba. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#65D69B" />
      {Array.from({ length: 24 }).map((_, i) => {
        const a = (i / 24) * Math.PI * 2;
        const r1 = i % 6 === 0 ? 9.5 : 11;
        return (
          <line key={i} x1={16 + Math.sin(a) * r1} y1={16 - Math.cos(a) * r1}
                x2={16 + Math.sin(a) * 12.5} y2={16 - Math.cos(a) * 12.5}
                stroke="#164D38" strokeWidth={i % 6 === 0 ? 1.6 : 0.9} strokeLinecap="round" />
        );
      })}
      <path d="M16 16 L16 8.5 M16 16 L21 19" stroke="#101713" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.8" fill="#101713" />
    </svg>
  );
}

export function Logo({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className={cn("font-display text-[17px] font-semibold tracking-tight", tone === "light" ? "text-white" : "text-ink")}>
        Funcionário 24h
      </span>
    </span>
  );
}
