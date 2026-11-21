"use client";
import * as React from "react";
import { DropdownMenu as M, Popover as P, Tooltip as T, Tabs as Tb, Switch as Sw } from "radix-ui";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export function MenuContent({ className, ...p }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={4} align="end" className={cn("z-50 min-w-44 rounded-[4px] border border-line-strong bg-panel p-1 text-xs shadow-xl", className)} {...p} />
    </M.Portal>
  );
}
export function MenuItem({ className, ...p }: React.ComponentProps<typeof M.Item>) {
  return <M.Item className={cn("flex cursor-pointer select-none items-center gap-2 rounded-[3px] px-2 py-1.5 outline-none data-[highlighted]:bg-raised data-[disabled]:opacity-40", className)} {...p} />;
}
export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <M.Label className="label-xs px-2 py-1">{children}</M.Label>;

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ className, ...p }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content sideOffset={4} align="end" className={cn("z-50 rounded-[4px] border border-line-strong bg-panel p-3 text-xs shadow-xl", className)} {...p} />
    </P.Portal>
  );
}

export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <T.Provider delayDuration={250}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content sideOffset={4} className="z-50 max-w-xs rounded-[3px] border border-line-strong bg-raised px-2 py-1 text-[11px] text-fg shadow-lg">{content}</T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}

export const Tabs = Tb.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof Tb.List>) {
  return <Tb.List className={cn("flex flex-wrap gap-0.5 border-b border-line", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof Tb.Trigger>) {
  return <Tb.Trigger className={cn("-mb-px cursor-pointer border-b-2 border-transparent px-3 py-1.5 text-xs text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg", className)} {...p} />;
}
export const TabsContent = ({ className, ...p }: React.ComponentProps<typeof Tb.Content>) => <Tb.Content className={cn("pt-3 outline-none", className)} {...p} />;

export function Switch({ className, ...p }: React.ComponentProps<typeof Sw.Root>) {
  return (
    <Sw.Root className={cn("relative h-4 w-7 cursor-pointer rounded-full bg-line-strong transition-colors data-[state=checked]:bg-accent", className)} {...p}>
      <Sw.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[14px]" />
    </Sw.Root>
  );
}
