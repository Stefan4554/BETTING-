import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[3px] text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent/85",
        outline: "border border-line-strong bg-transparent hover:bg-raised text-fg",
        ghost: "hover:bg-raised text-muted hover:text-fg",
        danger: "bg-down/15 text-down border border-down/40 hover:bg-down/25",
      },
      size: { sm: "h-6 px-2", md: "h-7 px-3", lg: "h-9 px-4 text-sm", icon: "h-7 w-7" },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
export { buttonVariants };
