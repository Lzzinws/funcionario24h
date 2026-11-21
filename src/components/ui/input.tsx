import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-md border border-line bg-white px-3 text-sm text-ink placeholder:text-sage transition-colors hover:border-sage/50 focus-visible:border-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40 disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(fieldBase, "h-10", className)} {...props} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, "min-h-24 py-2 leading-relaxed", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(fieldBase, "h-10 pr-8", className)} {...props} />,
);
NativeSelect.displayName = "NativeSelect";
