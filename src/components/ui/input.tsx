import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn("h-7 w-full rounded-[3px] border border-line-strong bg-panel-2 px-2 text-xs text-fg placeholder:text-dim focus:border-accent focus:outline-none num", className)}
    {...props}
  />
));
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn("h-7 rounded-[3px] border border-line-strong bg-panel-2 px-1.5 text-xs text-fg focus:border-accent focus:outline-none", className)}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("label-xs flex flex-col gap-1", className)} {...props} />;
}
