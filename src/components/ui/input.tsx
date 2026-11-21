import * as React from "react";
import { cn } from "@/lib/utils";

const field = "h-7 w-full rounded-[3px] border border-line-strong bg-panel-2 px-2 text-xs text-fg placeholder:text-dim focus:border-accent focus:outline-none disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(field, props.type === "number" || props.inputMode === "decimal" ? "num" : "", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, "h-auto min-h-16 py-1.5", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(field, "px-1.5", className)} {...props}>{children}</select>
));
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("label-xs flex flex-col gap-1", className)} {...props} />;
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <span className="text-[10.5px] normal-case tracking-normal text-down">{children}</span>;
}

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={cn("h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]", className)} {...props} />;
}
