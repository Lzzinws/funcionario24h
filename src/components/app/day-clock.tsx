/**
 * Relógio de 24 horas: cada raio é uma hora do dia; o comprimento indica
 * quantas mensagens foram trocadas naquela hora (últimos 7 dias).
 */
export function DayClock({ hourly, size = 260 }: { hourly: number[]; size?: number }) {
  const max = Math.max(1, ...hourly);
  const total = hourly.reduce((a, b) => a + b, 0);
  const peak = hourly.indexOf(Math.max(...hourly));
  const c = size / 2, inner = size * 0.27, outerMax = size * 0.47;
  const nightShare = total ? Math.round((hourly.filter((_, h) => h < 8 || h >= 18).reduce((a, b) => a + b, 0) / total) * 100) : 0;

  return (
    <figure className="flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[280px]" role="img"
           aria-label={total ? `Mensagens por hora nos últimos 7 dias. Pico às ${peak}h.` : "Ainda não há mensagens nos últimos 7 dias."}>
        {/* faixa noturna: fora do horário comercial (18h–8h) */}
        <path d={arcPath(c, c, outerMax + 6, 18, 32)} fill="none" stroke="#164D38" strokeOpacity="0.06" strokeWidth="12" />
        <circle cx={c} cy={c} r={inner - 10} fill="#164D38" />
        {hourly.map((v, h) => {
          const a = (h / 24) * Math.PI * 2 - Math.PI / 2 + Math.PI / 24;
          const len = v === 0 ? 3 : 6 + (v / max) * (outerMax - inner - 6);
          const x1 = c + Math.cos(a) * inner, y1 = c + Math.sin(a) * inner;
          const x2 = c + Math.cos(a) * (inner + len), y2 = c + Math.sin(a) * (inner + len);
          return (
            <line key={h} x1={x1} y1={y1} x2={x2} y2={y2} strokeLinecap="round" strokeWidth={size * 0.034}
                  stroke={v === 0 ? "#E2E7E4" : h === peak ? "#164D38" : "#65D69B"}>
              <title>{`${String(h).padStart(2, "0")}h: ${v} mensage${v === 1 ? "m" : "ns"}`}</title>
            </line>
          );
        })}
        {[0, 6, 12, 18].map((h) => {
          const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
          return (
            <text key={h} x={c + Math.cos(a) * (inner - 22)} y={c + Math.sin(a) * (inner - 22)} textAnchor="middle" dominantBaseline="central"
                  className="fill-white/55 text-[10px] tabular">{h}h</text>
          );
        })}
        <text x={c} y={c - 6} textAnchor="middle" className="fill-white font-display text-[26px] font-semibold tabular">{total}</text>
        <text x={c} y={c + 14} textAnchor="middle" className="fill-white/60 text-[10px]">mensagens</text>
      </svg>
      <figcaption className="mt-3 text-center text-[13px] text-sage-dark">
        {total ? <>Pico às <strong className="font-medium text-ink">{peak}h</strong> · {nightShare}% fora do horário comercial</> : "O relógio se preenche conforme os clientes conversam."}
      </figcaption>
    </figure>
  );
}

function arcPath(cx: number, cy: number, r: number, fromH: number, toH: number) {
  const p = (h: number) => {
    const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const [x1, y1] = p(fromH), [x2, y2] = p(toH);
  const large = toH - fromH > 12 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}
