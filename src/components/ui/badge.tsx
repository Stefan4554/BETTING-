import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-[2px] px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide leading-4 border", {
  variants: {
    tone: {
      neutral: "bg-raised text-muted border-line-strong",
      accent: "bg-accent-soft text-accent border-accent/40",
      up: "bg-up-soft text-up border-up/30",
      down: "bg-down-soft text-down border-down/30",
      warn: "bg-warn-soft text-warn border-warn/30",
      demo: "bg-demo/15 text-demo border-demo/40",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
