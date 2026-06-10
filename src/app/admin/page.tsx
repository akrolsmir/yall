'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import { id } from '@instantdb/react';
import { db } from '@/lib/db';
import { useViewer } from '@/lib/useViewer';
import { slugify } from '@/lib/slug';

const TX_CHUNK = 100;

export default function AdminPage() {
  const viewer = useViewer();

  const { data, isLoading } = db.useQuery(
    viewer.isAdmin
      ? {
          people: { claimedBy: {} },
          sources: { $: { order: { createdAt: 'desc' } } },
          claims: {
            $: { where: { status: 'pending' } },
            person: {},
            user: {},
          },
        }
      : null,
  );

  if (viewer.isLoading) return null;
  if (!viewer.user) {
    return (
      <Gate
        title="Admins only"
        body="Sign in with an admin account to manage the index."
        cta={
          <Link
            href="/login?next=/admin"
            className="inline-block font-mono text-xs uppercase tracking-widest bg-ink text-paper px-4 py-2 hover:bg-accent transition-colors"
          >
            Sign in
          </Link>
        }
      />
    );
  }
  if (!viewer.isAdmin) {
    return (
      <Gate
        title="Not an admin"
        body={`${viewer.user.email} doesn’t have admin access. Flip isAdmin on your $users row in the Instant dashboard.`}
      />
    );
  }

  const people = data?.people ?? [];
  const sources = data?.sources ?? [];
  const claims = data?.claims ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-10 space-y-10">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent mb-2">
          Admin
        </p>
        <h1 className="font-display font-semibold tracking-tight text-4xl">
          Index controls
        </h1>
      </div>

      <GenerationPanel people={people} />
      <UploadPanel people={people} />
      <ClaimsPanel claims={claims} />
      <SourcesPanel sources={sources} isLoading={isLoading} />
    </div>
  );
}

function Gate({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md px-6 pt-24 text-center">
      <h1 className="font-display font-semibold text-3xl mb-2">{title}</h1>
      <p className="text-sm text-ink-soft mb-6">{body}</p>
      {cta}
    </div>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-line bg-card">
      <div className="px-5 py-3 border-b border-line flex items-baseline justify-between gap-4">
        <h2 className="font-display font-semibold text-lg">{title}</h2>
        {hint && (
          <p className="font-mono text-[10px] uppercase tracking-widest text-faint">
            {hint}
          </p>
        )}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- generation

type PersonLite = {
  id: string;
  name: string;
  slug: string;
  status: string;
  humanEdited?: boolean;
};

function GenerationPanel({ people }: { people: PersonLite[] }) {
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const c = { none: 0, queued: 0, generating: 0, generated: 0, failed: 0 };
    for (const p of people) {
      c[(p.status as keyof typeof c) ?? 'none'] =
        (c[(p.status as keyof typeof c) ?? 'none'] ?? 0) + 1;
    }
    return c;
  }, [people]);

  const setStatuses = async (from: string[], to: string) => {
    setBusy(true);
    try {
      const targets = people.filter(
        (p) => from.includes(p.status) && !p.humanEdited,
      );
      for (let i = 0; i < targets.length; i += TX_CHUNK) {
        await db.transact(
          targets
            .slice(i, i + TX_CHUNK)
            .map((p) => db.tx.people[p.id].update({ status: to })),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const stat = (label: string, n: number, tone = 'text-ink') => (
    <div className="text-center px-4">
      <p className={`font-display font-semibold text-2xl ${tone}`}>
        {n.toLocaleString()}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-widest text-faint">
        {label}
      </p>
    </div>
  );

  return (
    <Panel
      title="Profile generation"
      hint="run `bun run generate` to process the queue"
    >
      <div className="flex flex-wrap items-center gap-y-4 justify-between">
        <div className="flex divide-x divide-line">
          {stat('Unprofiled', counts.none, 'text-faint')}
          {stat('Queued', counts.queued, 'text-accent')}
          {stat('Generating', counts.generating, 'text-accent')}
          {stat('Profiled', counts.generated, 'text-moss')}
          {stat('Failed', counts.failed, 'text-accent-deep')}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStatuses(['none'], 'queued')}
            disabled={busy || counts.none === 0}
            className="font-mono text-[10px] uppercase tracking-widest bg-ink text-paper px-3 py-2 hover:bg-accent transition-colors disabled:opacity-40"
          >
            Queue all unprofiled
          </button>
          <button
            onClick={() => setStatuses(['failed'], 'queued')}
            disabled={busy || counts.failed === 0}
            className="font-mono text-[10px] uppercase tracking-widest border border-ink px-3 py-2 hover:bg-ink hover:text-paper transition-colors disabled:opacity-40"
          >
            Retry failed
          </button>
          <button
            onClick={() => setStatuses(['queued'], 'none')}
            disabled={busy || counts.queued === 0}
            className="font-mono text-[10px] uppercase tracking-widest border border-line text-ink-soft px-3 py-2 hover:border-ink transition-colors disabled:opacity-40"
          >
            Clear queue
          </button>
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-soft">
        Queueing marks people for the local batch script. Run{' '}
        <code className="font-mono bg-paper-deep px-1 py-0.5">
          bun run generate
        </code>{' '}
        in the repo (needs <code className="font-mono">ANTHROPIC_API_KEY</code>{' '}
        in .env) — it researches each queued person on the web and writes their
        profile. Human-edited profiles are never queued or overwritten.
      </p>
    </Panel>
  );
}

// -------------------------------------------------------------------- upload

type UploadPerson = {
  id: string;
  slug: string;
  email?: string | null;
};

function UploadPanel({ people }: { people: UploadPerson[] }) {
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<{ name: string; email?: string }[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseFile = (file: File) => {
    setFileName(file.name);
    setResult(null);
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data;
        if (!data.length) return setRows([]);
        // Detect a header row; map name/email columns
        const header = data[0].map((h) => h.trim().toLowerCase());
        const hasHeader = header.includes('name');
        const nameIdx = hasHeader ? header.indexOf('name') : 0;
        const emailIdx = hasHeader
          ? header.indexOf('email')
          : data[0].findIndex((c) => c.includes('@'));
        const body = hasHeader ? data.slice(1) : data;
        const parsed = body
          .map((r) => ({
            name: (r[nameIdx] ?? '').trim(),
            email:
              emailIdx >= 0 ? (r[emailIdx] ?? '').trim() || undefined : undefined,
          }))
          .filter((r) => r.name);
        setRows(parsed);
      },
    });
  };

  const importRows = async () => {
    if (!rows.length || !description.trim()) return;
    setProgress('Preparing…');
    setResult(null);

    const existingBySlug = new Map(people.map((p) => [p.slug, p]));
    const sourceId = id();
    const now = Date.now();

    type Plan =
      | { kind: 'create'; personId: string; name: string; email?: string; slug: string }
      | { kind: 'link'; personId: string; email?: string };

    const plans: Plan[] = [];
    const seenSlugs = new Set<string>();
    let skipped = 0;

    for (const row of rows) {
      let slug = slugify(row.name);
      if (!slug) {
        skipped++;
        continue;
      }
      const existing = existingBySlug.get(slug);
      const sameEmail =
        existing &&
        (!row.email ||
          !existing.email ||
          existing.email.toLowerCase() === row.email.toLowerCase());
      if (existing && sameEmail) {
        // Same person re-uploaded: just attach the new source
        plans.push({ kind: 'link', personId: existing.id, email: row.email });
        continue;
      }
      // Distinct person with a colliding name: suffix the slug
      let n = 2;
      while (existingBySlug.has(slug) || seenSlugs.has(slug)) {
        slug = `${slugify(row.name)}-${n++}`;
      }
      if (seenSlugs.has(slug)) {
        skipped++;
        continue;
      }
      seenSlugs.add(slug);
      plans.push({
        kind: 'create',
        personId: id(),
        name: row.name,
        email: row.email,
        slug,
      });
    }

    await db.transact(
      db.tx.sources[sourceId].create({
        description: description.trim(),
        createdAt: now,
      }),
    );

    let created = 0;
    let linked = 0;
    for (let i = 0; i < plans.length; i += TX_CHUNK) {
      const chunk = plans.slice(i, i + TX_CHUNK);
      await db.transact(
        chunk.map((plan) => {
          if (plan.kind === 'create') {
            created++;
            return db.tx.people[plan.personId]
              .create({
                name: plan.name,
                slug: plan.slug,
                email: plan.email,
                status: 'none',
                createdAt: now,
              })
              .link({ sources: sourceId });
          }
          linked++;
          const tx = db.tx.people[plan.personId].link({ sources: sourceId });
          return plan.email
            ? db.tx.people[plan.personId]
                .update({ email: plan.email })
                .link({ sources: sourceId })
            : tx;
        }),
      );
      setProgress(
        `Importing… ${Math.min(i + TX_CHUNK, plans.length)} / ${plans.length}`,
      );
    }

    setProgress(null);
    setResult(
      `Done: ${created} added, ${linked} already in the index (source attached)${
        skipped ? `, ${skipped} skipped` : ''
      }.`,
    );
    setRows([]);
    setFileName(null);
    setDescription('');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Panel title="Upload people" hint="csv with name + optional email columns">
      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
              Where is this list from? (shown on profiles)
            </p>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Attendees of Manifest 2025"
              className="w-full bg-paper border border-line px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-faint"
            />
          </div>
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
              CSV file
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) parseFile(f);
              }}
              className="w-full text-sm file:font-mono file:text-[10px] file:uppercase file:tracking-widest file:bg-ink file:text-paper file:border-0 file:px-3 file:py-2 file:mr-3 file:cursor-pointer text-ink-soft"
            />
          </div>
          <button
            onClick={importRows}
            disabled={!rows.length || !description.trim() || !!progress}
            className="font-mono text-[10px] uppercase tracking-widest bg-accent text-paper px-4 py-2 hover:bg-accent-deep transition-colors disabled:opacity-40"
          >
            {progress ?? `Import ${rows.length.toLocaleString()} people`}
          </button>
          {result && <p className="text-xs text-moss">{result}</p>}
        </div>
        <div className="text-xs text-ink-soft space-y-2 border-l border-line pl-5">
          <p className="font-medium text-ink">Format</p>
          <p>
            A header row with <code className="font-mono">name</code> and
            optionally <code className="font-mono">email</code> columns — or no
            header, with names in the first column.
          </p>
          <p>
            Re-uploading an existing person (same name) just attaches the new
            source; same name with a different email creates a separate page
            with a suffixed slug.
          </p>
          {fileName && rows.length > 0 && (
            <p className="text-moss font-mono">
              {fileName}: {rows.length.toLocaleString()} rows parsed ✓
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

// -------------------------------------------------------------------- claims

type ClaimRow = {
  id: string;
  status: string;
  requesterEmail?: string | null;
  message?: string | null;
  createdAt: number;
  person?: { id: string; name: string; slug: string } | null;
};

function ClaimsPanel({ claims }: { claims: ClaimRow[] }) {
  const { user } = useViewer();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const review = async (claimId: string, action: 'approve' | 'reject') => {
    if (!user) return;
    setBusyId(claimId);
    setError(null);
    try {
      const res = await fetch('/api/claim/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: user.refresh_token,
          claimId,
          action,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Review failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Panel title="Claim requests" hint={`${claims.length} pending`}>
      {claims.length === 0 ? (
        <p className="text-sm text-faint">No pending claims.</p>
      ) : (
        <ul className="divide-y divide-line">
          {claims.map((c) => (
            <li
              key={c.id}
              className="py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-mono text-accent">
                    {c.requesterEmail}
                  </span>{' '}
                  wants{' '}
                  {c.person ? (
                    <Link
                      href={`/p/${c.person.slug}`}
                      className="font-display font-semibold underline underline-offset-2 hover:text-accent"
                    >
                      {c.person.name}
                    </Link>
                  ) : (
                    <span className="text-faint">(deleted person)</span>
                  )}
                </p>
                {c.message && (
                  <p className="text-xs text-ink-soft mt-1 max-w-xl">
                    “{c.message}”
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => review(c.id, 'approve')}
                  disabled={busyId === c.id}
                  className="font-mono text-[10px] uppercase tracking-widest bg-moss text-paper px-3 py-1.5 hover:opacity-80 transition-opacity disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  onClick={() => review(c.id, 'reject')}
                  disabled={busyId === c.id}
                  className="font-mono text-[10px] uppercase tracking-widest border border-line text-ink-soft px-3 py-1.5 hover:border-accent-deep hover:text-accent-deep transition-colors disabled:opacity-40"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-xs text-accent-deep">{error}</p>}
    </Panel>
  );
}

// ------------------------------------------------------------------- sources

function SourcesPanel({
  sources,
  isLoading,
}: {
  sources: { id: string; description: string; createdAt: number }[];
  isLoading: boolean;
}) {
  return (
    <Panel title="Sources" hint={`${sources.length} uploads`}>
      {isLoading ? (
        <p className="text-sm text-faint pulse-soft">Loading…</p>
      ) : sources.length === 0 ? (
        <p className="text-sm text-faint">
          Nothing uploaded yet — import a CSV above or run{' '}
          <code className="font-mono bg-paper-deep px-1 py-0.5">
            bun run seed
          </code>
          .
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {sources.map((s) => (
            <li key={s.id} className="py-2.5 flex justify-between gap-4">
              <span className="text-sm">{s.description}</span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-faint shrink-0">
                {new Date(s.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
