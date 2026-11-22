"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, SendHorizontal, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { resetTestConversation, sendTestMessage, type TestTurnState } from "./actions";

export type ChatMessage = { id: string; direction: "inbound" | "outbound"; sender_type: string; content: string; created_at: string };

const SUGGESTIONS = ["Oi! Quais serviços vocês oferecem?", "Quanto custa?", "Quero marcar um horário para amanhã às 10h", "Consegue me dar um desconto?"];

export function TestChat({ employeeId, employeeName, initial, disabled }: { employeeId: string; employeeName: string; initial: ChatMessage[]; disabled?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<ChatMessage | null>(null);
  const [last, setLast] = useState<TestTurnState | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const messages = optimistic && !initial.some((m) => m.content === optimistic.content && m.direction === "inbound" && m.created_at >= optimistic.created_at)
    ? [...initial, optimistic] : initial;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, pending]);

  function send(text: string) {
    const t = text.trim();
    if (!t || pending) return;
    setDraft("");
    setLast(null);
    setOptimistic({ id: "tmp", direction: "inbound", sender_type: "contact", content: t, created_at: new Date().toISOString() });
    start(async () => {
      const r = await sendTestMessage(employeeId, t);
      setLast(r);
      setOptimistic(null);
      router.refresh();
    });
  }

  return (
    <div className="flex h-[min(70dvh,640px)] flex-col overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-sm"><span className="font-medium">{employeeName}</span> <span className="text-sage-dark">· conversa de teste</span></p>
        <Button variant="ghost" size="sm" disabled={pending || !initial.length} onClick={() => start(async () => { await resetTestConversation(employeeId); setLast(null); router.refresh(); })}>
          <RotateCcw aria-hidden /> Reiniciar
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto bg-paper px-4 py-5" aria-live="polite">
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div className="max-w-sm">
              <p className="font-display text-lg font-semibold">Converse como se fosse um cliente</p>
              <p className="mt-1 text-sm text-sage-dark">As respostas usam a IA real, a base de conhecimento e as permissões deste funcionário. Ações sensíveis geram pedidos de aprovação de verdade.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" disabled={!!disabled || pending} onClick={() => send(s)} className="rounded-full border border-line bg-white px-3 py-1.5 text-[13px] hover:border-sage/60 disabled:opacity-50">{s}</button>
                ))}
              </div>
            </div>
          </div>
        ) : messages.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "inbound" ? "justify-end" : "justify-start")}>
            <p className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed",
              m.direction === "inbound" ? "rounded-br-sm bg-forest text-white" : m.sender_type === "system" ? "rounded-bl-sm bg-amber-soft text-ink" : "rounded-bl-sm bg-white text-ink shadow-[0_0_0_1px_var(--color-line)]")}>
              {m.content}
            </p>
          </div>
        ))}
        {pending ? <p className="text-[13px] text-sage-dark">{employeeName} está escrevendo…</p> : null}
        <div ref={endRef} />
      </div>

      {last ? (
        <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs", last.ok ? "text-sage-dark" : "bg-danger-soft text-danger")} role={last.ok ? "status" : "alert"}>
          {last.message ? <span>{last.message}</span> : null}
          {last.info ? (
            <>
              <span className="inline-flex items-center gap-1"><Wrench className="size-3.5" aria-hidden />{last.info.tools.length ? last.info.tools.join(", ") : "sem ferramentas"}</span>
              {last.info.approvals ? <span className="inline-flex items-center gap-1 text-amber"><ShieldCheck className="size-3.5" aria-hidden />{last.info.approvals} pedido(s) de aprovação criado(s)</span> : null}
              {last.info.handoff ? <span className="text-amber">Conversa transferida para humano</span> : null}
              <span className="tabular ml-auto">{last.info.tokens.toLocaleString("pt-BR")} tokens · US$ {last.info.costUsd}</span>
            </>
          ) : null}
        </div>
      ) : null}

      <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <label htmlFor="test-msg" className="sr-only">Mensagem de teste</label>
        <Textarea id="test-msg" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!!disabled || pending} maxLength={4000}
          placeholder={disabled ?? "Escreva como um cliente escreveria no WhatsApp"} className="min-h-11 flex-1 resize-none"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} rows={1} />
        <Button type="submit" size="icon" className="size-11" disabled={!!disabled || pending || !draft.trim()} aria-label="Enviar mensagem de teste"><SendHorizontal aria-hidden /></Button>
      </form>
    </div>
  );
}
