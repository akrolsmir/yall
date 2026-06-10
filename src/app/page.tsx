'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
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
      {/* Masthead */}
      <section className="pt-12 pb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent mb-3 rise-in">
          The People Index
        </p>
        <h1
          className="font-display font-semibold tracking-tight text-5xl sm:text-6xl leading-[1.05] rise-in"
          style={{ animationDelay: '60ms' }}
        >
          Everyone in the field,
          <br />
          <span className="italic font-normal text-ink-soft">
            one page each.
          </span>
        </h1>
        <p
          className="mt-4 max-w-xl text-ink-soft rise-in"
          style={{ animationDelay: '120ms' }}
        >
          A public wiki of the people shaping this field — AI-drafted,
          human-corrected. Find someone, read their story, or claim your own
          page.
        </p>
      </section>

      <div className="rule-double" />

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

        {!isLoading && !error && filtered.length === 0 && (
          <p className="px-4 py-12 text-center text-sm text-faint">
            No one matches{query ? ` “${query}”` : ' these filters'}.
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
              className="grid grid-cols-[1.4fr_2fr_1fr] sm:grid-cols-[1.2fr_2.2fr_1fr_1.2fr] gap-x-4 px-4 py-3 items-baseline group hover:bg-accent-wash/40 transition-colors"
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
              <span className="flex flex-wrap gap-1 min-w-0">
                {(p.tags ?? []).slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[10px] px-1.5 py-0.5 bg-moss-wash text-moss truncate max-w-full"
                  >
                    {t}
                  </span>
                ))}
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
      </section>
    </div>
  );
}
