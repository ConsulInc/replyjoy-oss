import type { HTMLAttributes } from "react";

import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white/92 p-5 text-card-foreground shadow-panel backdrop-blur-sm",
        className,
      )}
      {...props}
    />
  );
}
