"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LogOut, Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

type Props = { orgName: string; planName: string | null; userEmail?: string; onDuty: number; signOut: () => Promise<void> };

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="grid gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-[14px] transition-colors",
                active ? "bg-white/10 font-medium text-white" : "text-white/65 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className={cn("size-[18px]", active ? "text-mint" : "")} aria-hidden />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SidebarBody({ orgName, planName, userEmail, onDuty, signOut, onNavigate }: Props & { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/painel" onClick={onNavigate} className="px-2 pt-1"><Logo tone="light" /></Link>
      <div className="rounded-md bg-forest-deep/60 px-3 py-2.5">
        <p className="truncate text-[14px] font-medium text-white">{orgName}</p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-white/60">
          <span className={cn("size-1.5 rounded-full", onDuty > 0 ? "on-duty bg-mint" : "bg-white/30")} aria-hidden />
          {onDuty > 0 ? `${onDuty} em serviço agora` : "Nenhum funcionário ativo"}
          {planName ? <span className="ml-auto text-white/45">{planName}</span> : null}
        </p>
      </div>
      <nav aria-label="Principal" className="flex-1"><NavList onNavigate={onNavigate} /></nav>
      <div className="border-t border-white/10 pt-4">
        {userEmail ? <p className="truncate px-3 text-xs text-white/50">{userEmail}</p> : null}
        <form action={signOut}>
          <button type="submit" className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-[14px] text-white/65 hover:bg-white/5 hover:text-white">
            <LogOut className="size-[18px]" aria-hidden /> Sair
          </button>
        </form>
      </div>
    </div>
  );
}

export function Sidebar(props: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-forest lg:block">
        <SidebarBody {...props} />
      </aside>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-forest px-4 lg:hidden">
        <Link href="/painel"><Logo tone="light" /></Link>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger className="grid size-10 place-items-center rounded-md text-white hover:bg-white/10" aria-label="Abrir menu">
            <Menu className="size-5" />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/50 data-[state=open]:animate-in" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] bg-forest shadow-xl focus:outline-none">
              <Dialog.Title className="sr-only">Menu</Dialog.Title>
              <Dialog.Close className="absolute right-3 top-3 grid size-9 place-items-center rounded-md text-white/70 hover:bg-white/10" aria-label="Fechar menu">
                <X className="size-5" />
              </Dialog.Close>
              <SidebarBody {...props} onNavigate={() => setOpen(false)} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </header>
    </>
  );
}
