"use client";

import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = "SheetOverlay";

const sheetOuterVariants = cva(
  [
    "fixed z-[70] flex flex-col border shadow-2xl transition ease-in-out",
    "data-[state=open]:animate-in data-[state=closed]:animate-out",
    "data-[state=closed]:duration-200 data-[state=open]:duration-300",
  ].join(" "),
  {
    variants: {
      side: {
        right:
          "inset-y-0 right-0 h-full w-full sm:max-w-md border-l border-white/10 glass-terminal data-[state=closed]:slide-out-to-right-8 data-[state=open]:slide-in-from-right-8",
        left: "inset-y-0 left-0 h-full w-full sm:max-w-md border-r border-white/10 glass-terminal",
      },
    },
    defaultVariants: { side: "right" },
  },
);

type SheetContentProps = React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> &
  VariantProps<typeof sheetOuterVariants>;

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetOuterVariants({ side }), className)}
      aria-describedby={undefined}
      {...props}
    >
      {children}
      <SheetPrimitive.Close
        className="absolute right-3 top-3 rounded-sm border border-white/10 p-1.5 text-slate-500 opacity-90 ring-offset-zinc-950 transition hover:text-white focus:outline-none focus:ring-1 focus:ring-white/20"
        aria-label="Close"
      >
        <X className="h-4 w-4" strokeWidth={1.5} />
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = "SheetContent";

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 border-b border-white/10 p-4 pr-10",
      className,
    )}
    {...props}
  />
);
const SheetTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "font-mono text-sm font-medium tracking-tight text-slate-200",
      className,
    )}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";
const SheetDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-xs text-slate-500", className)} {...props} />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
