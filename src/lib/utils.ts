import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRL = (cents: number | null | undefined) => (cents == null ? "—" : brl.format(cents / 100));

const num = new Intl.NumberFormat("pt-BR");
export const formatNumber = (n: number | null | undefined) => (n == null ? "—" : num.format(n));

export function formatCompact(n: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1).replace(".", ",")} h`;
}

export function formatRelative(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (diff < 60) return "agora";
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

/** Converte "1.234,56" ou "1234.56" em centavos. Retorna null se vazio/ inválido. */
export function parseBRLToCents(input: string | null | undefined): number | null {
  if (!input) return null;
  const clean = input.replace(/[^\d,.-]/g, "");
  if (!clean) return null;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
}
