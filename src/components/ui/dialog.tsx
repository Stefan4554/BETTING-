"use client";
import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, wide, ...props }:
  React.ComponentProps<typeof D.Content> & { title: React.ReactNode; description?: React.ReactNode; wide?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-[6vh] z-50 flex max-h-[88vh] w-[calc(100vw-24px)] -translate-x-1/2 flex-col rounded-[4px] border border-line-strong bg-panel shadow-2xl",
          wide ? "max-w-4xl" : "max-w-lg",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5">
          <div>
            <D.Title className="text-sm font-semibold">{title}</D.Title>
            {description ? <D.Description className="text-[11px] text-muted">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
          </div>
          <D.Close className="rounded p-1 text-muted hover:bg-raised hover:text-fg" aria-label="Close"><X className="h-4 w-4" /></D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
