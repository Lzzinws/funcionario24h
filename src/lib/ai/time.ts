/** Converte "AAAA-MM-DDTHH:MM" no fuso da empresa para um instante UTC (ISO). */
export function localToUtcIso(local: string, timeZone: string): string {
  const [d, t] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  // Descobre o deslocamento do fuso naquele instante e corrige.
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60_000).toISOString();
}

export function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** Data/hora local legível para o modelo e para o cliente. */
export function formatLocal(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "full", timeStyle: "short" }).format(new Date(iso));
}
