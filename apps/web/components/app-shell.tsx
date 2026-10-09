"use client";

import { ChatCircleText, FileText, SignOut } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { IconButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const NAV = [
  { href: "/documents", label: "Documents", Icon: FileText },
  { href: "/chat", label: "Chat", Icon: ChatCircleText },
] as const;


const LINK = "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors duration-150";

/** The current page is known only at request time, so this part streams in on its own. */
function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1">
      {NAV.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${LINK} ${active ? "bg-subtle text-ink" : "text-muted hover:bg-subtle hover:text-ink"}`}
          >
            <Icon size={18} weight="bold" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Same links without the "current page" mark, shown until the address is known. */
function MainNavFallback() {
  return (
    <nav aria-label="Main" className="flex gap-1">
      {NAV.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className={`${LINK} text-muted hover:bg-subtle hover:text-ink`}>
          <Icon size={18} weight="bold" aria-hidden />
          <span className="hidden sm:inline">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Signed-in frame: header with navigation, and the page below. Sends visitors to sign in. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full max-w-3xl" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-line bg-surface px-4 sm:px-6">
        <Link href="/documents" className="font-serif text-2xl tracking-[-0.02em] text-ink">
          Library
        </Link>
        <Suspense fallback={<MainNavFallback />}>
          <MainNav />
        </Suspense>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <span className="hidden max-w-[16rem] truncate text-sm text-muted md:block">{user.email}</span>
          <IconButton
            label="Sign out"
            onClick={async () => {
              await signOut();
              router.replace("/login");
            }}
          >
            <SignOut size={18} weight="bold" aria-hidden />
          </IconButton>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  );
}
