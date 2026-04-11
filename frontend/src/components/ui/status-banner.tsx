import type { HTMLAttributes } from "react";

import { cn } from "../../lib/utils";

const toneClasses = {
  info: "border-primary/20 bg-blue-50 text-foreground",
  success: "border-emerald-200 bg-emerald-50 text-foreground",
  warning: "border-amber-200 bg-amber-50 text-foreground",
  error: "border-red-200 bg-red-50 text-foreground",
} as const;

export function StatusBanner({
  className,
  tone = "info",
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof toneClasses }) {
  return (
    <div
      className={cn("rounded-lg border px-4 py-3 text-sm shadow-panel", toneClasses[tone], className)}
      {...props}
    />
  );
}
