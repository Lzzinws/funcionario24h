import * as React from "react";
import { cn } from "@/lib/utils";

/** Campo com rótulo visível, dica opcional e mensagem de erro associada. */
export function Field({
  label, htmlFor, hint, error, className, children,
}: {
  label: string; htmlFor: string; hint?: string; error?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">{label}</label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-[13px] text-danger">{error}</p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[13px] text-sage-dark">{hint}</p>
      ) : null}
    </div>
  );
}
