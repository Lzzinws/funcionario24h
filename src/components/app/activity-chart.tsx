"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { day: string; conversations: number; messages: number };

export function ActivityChart({ data }: { data: Point[] }) {
  const rows = data.map((d) => ({ ...d, label: new Date(d.day + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) }));
  return (
    <div className="h-56 w-full" role="img" aria-label="Conversas e mensagens por dia nos últimos 14 dias">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="msgs" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#65D69B" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#65D69B" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#E2E7E4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#89958E", fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#89958E", fontSize: 11 }} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid #E2E7E4", fontSize: 12 }}
            formatter={(v, name) => [v, name === "messages" ? "Mensagens" : "Conversas novas"]}
          />
          <Area type="monotone" dataKey="messages" stroke="#65D69B" strokeWidth={2} fill="url(#msgs)" />
          <Area type="monotone" dataKey="conversations" stroke="#164D38" strokeWidth={2} fill="transparent" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
