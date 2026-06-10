'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { db } from '@/lib/db';
import { useViewer } from '@/lib/useViewer';

export default function Header() {
  const pathname = usePathname();
  const { user, isAdmin } = useViewer();

  const navLink = (href: string, label: string) => {
    const active =
      href === '/' ? pathname === '/' : pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={`font-mono text-xs uppercase tracking-widest px-2 py-1 transition-colors ${
          active ? 'text-accent' : 'text-ink-soft hover:text-ink'
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="border-b border-line bg-paper/90 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-baseline gap-2 group">
          <span className="font-display text-2xl font-semibold tracking-tight lowercase">
            y<span className="text-accent group-hover:text-accent-deep transition-colors">’</span>all
          </span>
          <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-widest text-faint">
            a wiki of everyone
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3">
          {navLink('/', 'Directory')}
          {isAdmin && navLink('/admin', 'Admin')}
          {user ? (
            <button
              onClick={() => db.auth.signOut()}
              className="font-mono text-xs text-faint hover:text-ink px-2 py-1 transition-colors"
              title={user.email ?? undefined}
            >
              Sign out
            </button>
          ) : (
            <Link
              href="/login"
              className="font-mono text-xs uppercase tracking-widest bg-ink text-paper px-3 py-1.5 hover:bg-accent transition-colors"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
