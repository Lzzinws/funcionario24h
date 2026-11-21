import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-ink/5 text-sage-dark",
      success: "bg-mint-soft text-forest",
      warning: "bg-amber-soft text-amber",
      danger: "bg-danger-soft text-danger",
      dark: "bg-forest text-white",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
