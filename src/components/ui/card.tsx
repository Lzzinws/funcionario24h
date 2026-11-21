import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line bg-white", className)} {...props} />;
}

export function CardHeader({ title, description, action, className }: {
  title: string; description?: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-5", className)}>
      <div className="min-w-0">
        <h2 className="font-display text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-sage-dark">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}
