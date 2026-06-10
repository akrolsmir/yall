'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/db';
import { STATUS_LABELS, PersonStatus } from '@/lib/types';

const PAGE_SIZE = 100;

type StatusFilter = 'all' | 'generated' | 'none' | 'claimed';

export default function DirectoryPage() {
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [orgFilter, setOrgFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Light rows only — long-form content lives on the linked `profiles`
  // entity, so this stays fast even at 10k+ people.
  const { isLoading, error, data } = db.useQuery({
    people: { claimedBy: {} },
  });

  const people = useMemo(() => data?.people ?? [], [data?.people]);

  const { allTags, allOrgs } = useMemo(() => {
    const tagCounts = new Map<string, number>();
    const orgCounts = new Map<string, number>();
    for (const p of people) {
      for (const t of p.tags ?? []) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
      if (p.primaryOrg) {
        orgCounts.set(p.primaryOrg, (orgCounts.get(p.primaryOrg) ?? 0) + 1);
      }
    }
    const byCount = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return { allTags: byCount(tagCounts), allOrgs: byCount(orgCounts) };
  }, [people]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => {
        if (q) {
          const hay = `${p.name} ${p.primaryOrg ?? ''} ${(p.tags ?? []).join(
            ' ',
          )}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (tagFilter && !(p.tags ?? []).includes(tagFilter)) return false;
        if (orgFilter && p.primaryOrg !== orgFilter) return false;
        if (statusFilter === 'generated' && p.status !== 'generated')
          return false;
        if (statusFilter === 'none' && p.status === 'generated') return false;
        if (statusFilter === 'claimed' && !p.claimedBy) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people, query, tagFilter, orgFilter, statusFilter]);

  const profiledCount = useMemo(
    () => people.filter((p) => p.status === 'generated').length,
    [people],
  );

  const shown = filtered.slice(0, visible);

  return (
    <div className="mx-auto max-w-6xl px-6">

      {/* Controls */}
      <section className="py-4 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          placeholder="Search names, orgs, tags…"
          className="flex-1 min-w-56 bg-card border border-line px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-faint"
        />
        <select
          value={tagFilter}
          onChange={(e) => {
            setTagFilter(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          className="bg-card border border-line px-2 py-2 text-sm font-mono text-ink-soft outline-none focus:border-accent max-w-48"
        >
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={orgFilter}
          onChange={(e) => {
            setOrgFilter(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          className="bg-card border border-line px-2 py-2 text-sm font-mono text-ink-soft outline-none focus:border-accent max-w-48"
        >
          <option value="">All orgs</option>
          {allOrgs.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <div className="flex border border-line divide-x divide-line text-xs font-mono">
          {(
            [
              ['all', 'All'],
              ['generated', 'Profiled'],
              ['none', 'Unprofiled'],
              ['claimed', 'Claimed'],
            ] as [StatusFilter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                setStatusFilter(value);
                setVisible(PAGE_SIZE);
              }}
              className={`px-3 py-2 transition-colors ${
                statusFilter === value
                  ? 'bg-ink text-paper'
                  : 'bg-card text-ink-soft hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Count line */}
      <p className="font-mono text-[11px] uppercase tracking-widest text-faint pb-2">
        {isLoading
          ? 'Loading…'
          : `${filtered.length.toLocaleString()} ${
              filtered.length === 1 ? 'person' : 'people'
            }${
              query || tagFilter || orgFilter || statusFilter !== 'all'
                ? ` of ${people.length.toLocaleString()}`
                : ''
            } · ${profiledCount.toLocaleString()} profiled`}
      </p>

      {/* Table */}
      <section className="border border-line bg-card mb-10">
        <div className="grid grid-cols-[1.4fr_2fr_1fr] sm:grid-cols-[1.2fr_2.2fr_1fr_1.2fr] gap-x-4 px-4 py-2.5 border-b border-ink font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
          <span>Name</span>
          <span>Bio</span>
          <span className="hidden sm:block">Organization</span>
          <span>Tags</span>
        </div>

        {error && (
          <p className="px-4 py-8 text-sm text-accent-deep">
            Failed to load directory: {error.message}
          </p>
        )}

        {!isLoading && !error && filtered.length === 0 && !query.trim() && (
          <p className="px-4 py-12 text-center text-sm text-faint">
            No one matches these filters.
          </p>
        )}

        {isLoading && (
          <div className="divide-y divide-line">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 py-3.5 pulse-soft">
                <div className="h-3.5 w-40 bg-paper-deep rounded-sm" />
              </div>
            ))}
          </div>
        )}

        <div className="divide-y divide-line">
          {shown.map((p) => (
            <Link
              key={p.id}
              href={`/p/${p.slug}`}
              className="grid grid-cols-[1.4fr_2fr_1fr] sm:grid-cols-[1.2fr_2.2fr_1fr_1.2fr] gap-x-4 px-4 py-2.5 items-baseline group hover:bg-accent-wash/40 transition-colors"
            >
              <span className="font-display font-semibold text-[15px] group-hover:text-accent-deep transition-colors flex items-baseline gap-1.5 min-w-0">
                <span className="truncate">{p.name}</span>
                {p.claimedBy && (
                  <span
                    className="text-moss text-xs shrink-0"
                    title="Claimed by its subject"
                  >
                    ✓
                  </span>
                )}
              </span>
              <span className="text-sm text-ink-soft truncate">
                {p.bio ?? (
                  <span className="text-faint italic text-xs">
                    {STATUS_LABELS[(p.status as PersonStatus) ?? 'none'] ??
                      'No profile'}
                  </span>
                )}
              </span>
              <span className="hidden sm:block text-sm truncate">
                {p.primaryOrg ?? ''}
              </span>
              <span className="flex items-center gap-1 min-w-0 overflow-hidden">
                {(p.tags ?? []).slice(0, 2).map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[10px] px-1.5 py-0.5 bg-moss-wash text-moss whitespace-nowrap truncate"
                  >
                    {t}
                  </span>
                ))}
                {(p.tags?.length ?? 0) > 2 && (
                  <span className="font-mono text-[10px] text-faint shrink-0">
                    +{p.tags!.length - 2}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>

        {filtered.length > visible && (
          <button
            onClick={() => setVisible((v) => v + 200)}
            className="w-full py-3 font-mono text-xs uppercase tracking-widest text-ink-soft hover:bg-paper-deep transition-colors border-t border-line"
          >
            Show more ({(filtered.length - visible).toLocaleString()}{' '}
            remaining)
          </button>
        )}

        {query.trim() && <AddPersonRow query={query.trim()} noMatches={filtered.length === 0} />}
      </section>
    </div>
  );
}

function AddPersonRow({
  query,
  noMatches,
}: {
  query: string;
  noMatches: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(query);
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, context }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add');
      router.push(`/p/${json.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => {
          setName(query);
          setOpen(true);
        }}
        className="w-full px-4 py-4 text-left border-t border-dashed border-line hover:bg-accent-wash/40 transition-colors group"
      >
        <span className="text-sm text-ink-soft">
          {noMatches ? 'No one matches.' : 'Not the person you’re after?'}{' '}
        </span>
        <span className="text-sm font-medium text-accent group-hover:text-accent-deep">
          + Add “{query}” to the index
        </span>
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="border-t border-dashed border-line px-4 py-4 space-y-3 bg-paper-deep/40"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
        Add a person
      </p>
      <div className="flex flex-wrap gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Full name"
          className="flex-1 min-w-48 bg-card border border-line px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-faint"
        />
        <input
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Optional context — a LinkedIn URL, or “runs ops at Lightcone”"
          className="flex-[2] min-w-64 bg-card border border-line px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-faint"
        />
      </div>
      <p className="text-xs text-faint">
        Context helps the research agent find the right person later. The page
        is created empty — generate a profile from it whenever you like.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="font-mono text-[10px] uppercase tracking-widest bg-accent text-paper px-4 py-2 hover:bg-accent-deep transition-colors disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add to index'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono text-[10px] uppercase tracking-widest text-faint hover:text-ink transition-colors"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-accent-deep">{error}</span>}
      </div>
    </form>
  );
}
