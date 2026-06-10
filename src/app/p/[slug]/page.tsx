'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { id, InstaQLEntity } from '@instantdb/react';
import { db } from '@/lib/db';
import { useViewer } from '@/lib/useViewer';
import { AppSchema } from '@/instant.schema';
import { PersonFull, STATUS_LABELS, PersonStatus } from '@/lib/types';

type Run = InstaQLEntity<AppSchema, 'runs'>;

export default function PersonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const viewer = useViewer();
  const [editing, setEditing] = useState(false);

  const { isLoading, error, data } = db.useQuery({
    people: {
      $: { where: { slug } },
      profile: {},
      claimedBy: {},
      sources: {},
    },
  });
  // Perms restrict claims to the viewer's own, so this returns only my claims
  const { data: claimsData } = db.useQuery(
    viewer.user ? { claims: { person: {} } } : null,
  );
  // Latest generation run — its trace renders live while it works
  const { data: runsData } = db.useQuery({
    runs: {
      $: {
        where: { 'person.slug': slug },
        order: { createdAt: 'desc' },
        limit: 1,
      },
    },
  });
  const latestRun = (runsData?.runs?.[0] ?? null) as Run | null;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 pt-16 pulse-soft">
        <div className="h-10 w-72 bg-paper-deep rounded-sm mb-4" />
        <div className="h-4 w-96 bg-paper-deep rounded-sm" />
      </div>
    );
  }
  if (error) {
    return (
      <p className="mx-auto max-w-4xl px-6 pt-16 text-accent-deep">
        Error: {error.message}
      </p>
    );
  }

  const person = data?.people?.[0] as PersonFull | undefined;
  if (!person) {
    return (
      <div className="mx-auto max-w-4xl px-6 pt-20 text-center">
        <h1 className="font-display text-4xl font-semibold mb-3">
          Nobody here
        </h1>
        <p className="text-ink-soft mb-6">
          No profile exists at <span className="font-mono">/p/{slug}</span>.
        </p>
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-accent hover:text-accent-deep"
        >
          ← Back to the directory
        </Link>
      </div>
    );
  }

  const isClaimer = !!viewer.user && person.claimedBy?.id === viewer.user.id;
  const canEdit = viewer.isAdmin || isClaimer;
  const myPendingClaim = (claimsData?.claims ?? []).find(
    (c) => c.person?.id === person.id && c.status === 'pending',
  );

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-4">
      <Link
        href="/"
        className="font-mono text-[11px] uppercase tracking-widest text-faint hover:text-accent transition-colors"
      >
        ← Directory
      </Link>

      {/* Masthead */}
      <div className="mt-4 pb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="rise-in">
          <h1 className="font-display font-semibold tracking-tight text-4xl sm:text-5xl leading-tight">
            {person.name}
          </h1>
          {person.bio && (
            <p className="mt-2 max-w-2xl text-lg text-ink-soft">
              {person.bio}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {person.claimedBy && (
            <span className="font-mono text-[10px] uppercase tracking-widest bg-moss-wash text-moss px-2 py-1">
              ✓ Claimed
            </span>
          )}
          {person.status !== 'generated' && (
            <span
              className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 bg-paper-deep text-ink-soft ${
                person.status === 'generating' ? 'pulse-soft' : ''
              }`}
            >
              {STATUS_LABELS[(person.status as PersonStatus) ?? 'none'] ??
                person.status}
            </span>
          )}
          {canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="font-mono text-[10px] uppercase tracking-widest bg-ink text-paper px-3 py-1 hover:bg-accent transition-colors"
            >
              Edit
            </button>
          )}
          {!editing && <GenerateButtons person={person} />}
        </div>
      </div>

      <div className="rule-double" />

      {editing ? (
        <EditForm person={person} onClose={() => setEditing(false)} />
      ) : (
        <div className="grid md:grid-cols-[1fr_260px] gap-10 pt-8">
          {/* Main column */}
          <article className="min-w-0">
            {latestRun &&
              (latestRun.status === 'running' ||
                person.status === 'generating' ||
                (latestRun.status === 'failed' && !person.profile?.article)) && (
                <RunTrace run={latestRun} />
              )}
            {person.profile?.summary ? (
              <div className="prose-article text-[1.125rem] text-ink-soft border-l-2 border-accent pl-5 mb-8">
                <ReactMarkdown>{person.profile.summary}</ReactMarkdown>
              </div>
            ) : null}
            {person.profile?.article ? (
              <div className="prose-article">
                <ReactMarkdown>{person.profile.article}</ReactMarkdown>
              </div>
            ) : person.status === 'generating' ? null : (
              <div className="py-12 text-center border border-dashed border-line">
                <p className="font-display text-xl text-ink-soft mb-1">
                  No article yet
                </p>
                <p className="text-sm text-faint mb-4">
                  {person.status === 'queued'
                    ? 'A profile is queued to be researched and written.'
                    : 'This person is in the index but their page hasn’t been written.'}
                </p>
                <GenerateButtons person={person} />
              </div>
            )}
            {person.profile?.generatedAt && !person.humanEdited && (
              <p className="mt-8 font-mono text-[10px] uppercase tracking-widest text-faint">
                Drafted by AI from public sources on{' '}
                {new Date(person.profile.generatedAt).toLocaleDateString()} —
                may contain errors.
              </p>
            )}
            {person.humanEdited && (
              <p className="mt-8 font-mono text-[10px] uppercase tracking-widest text-moss">
                Edited by a human
                {person.claimedBy ? ' — claimed by its subject' : ''}.
              </p>
            )}
          </article>

          {/* Sidebar */}
          <aside className="space-y-6 md:border-l md:border-line md:pl-6">
            <FactBlock label="Primary org">
              {person.primaryOrg || <Faint>—</Faint>}
            </FactBlock>
            {(person.otherOrgs?.length ?? 0) > 0 && (
              <FactBlock label="Also affiliated">
                <ul className="space-y-0.5">
                  {person.otherOrgs!.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </FactBlock>
            )}
            {(person.tags?.length ?? 0) > 0 && (
              <FactBlock label="Fields">
                <div className="flex flex-wrap gap-1">
                  {person.tags!.map((t) => (
                    <span
                      key={t}
                      className="font-mono text-[10px] px-1.5 py-0.5 bg-moss-wash text-moss"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </FactBlock>
            )}
            {(person.profile?.links?.length ?? 0) > 0 && (
              <FactBlock label="On the web">
                <ul className="space-y-1">
                  {person.profile!.links!.map((l) => (
                    <li key={l.url}>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:text-accent-deep underline underline-offset-2 break-all text-sm"
                      >
                        {l.label || l.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </FactBlock>
            )}
            {(person.sources?.length ?? 0) > 0 && (
              <FactBlock label="Listed via">
                <ul className="space-y-0.5 text-sm text-ink-soft">
                  {person.sources!.map((s) => (
                    <li key={s.id}>{s.description}</li>
                  ))}
                </ul>
              </FactBlock>
            )}
            <ClaimPanel
              person={person}
              isClaimer={isClaimer}
              hasPendingClaim={!!myPendingClaim}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

function GenerateButtons({ person }: { person: PersonFull }) {
  const [busyMode, setBusyMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generating = person.status === 'generating';

  const kickOff = async (mode: 'fast' | 'deep') => {
    setBusyMode(mode);
    setError(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: person.id, mode }),
      });
      // The run's live trace shows progress; we only surface kickoff errors.
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to start');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setBusyMode(null);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex gap-2">
        <button
          onClick={() => kickOff('fast')}
          disabled={generating || !!busyMode}
          title="Haiku, up to 3 web searches — a quick draft in ~30s"
          className="font-mono text-[10px] uppercase tracking-widest border border-accent text-accent px-3 py-1 hover:bg-accent hover:text-paper transition-colors disabled:opacity-40"
        >
          {generating ? 'Working…' : '⚡ Fast profile'}
        </button>
        <button
          onClick={() => kickOff('deep')}
          disabled={generating || !!busyMode}
          title="Opus, up to 10 web searches with extended thinking — a few minutes"
          className="font-mono text-[10px] uppercase tracking-widest bg-accent text-paper px-3 py-1 hover:bg-accent-deep transition-colors disabled:opacity-40"
        >
          {generating ? 'Working…' : '◉ Deep research'}
        </button>
      </span>
      {error && <span className="text-xs text-accent-deep">{error}</span>}
    </span>
  );
}

const TRACE_GLYPHS: Record<string, string> = {
  status: '◌',
  search: '⌕',
  results: '≡',
  thinking: '…',
  draft: '✎',
  done: '✓',
  error: '✗',
};

function RunTrace({ run }: { run: Run }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const events = run.trace ?? [];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="mb-8 border border-line bg-ink text-paper/90">
      <div className="px-4 py-2 flex items-center justify-between border-b border-paper/15">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper/60">
          {run.mode === 'deep' ? 'Deep research' : 'Fast profile'} ·{' '}
          {run.status === 'running' ? (
            <span className="text-accent-wash pulse-soft">researching…</span>
          ) : run.status === 'failed' ? (
            <span className="text-red-300">failed</span>
          ) : (
            'done'
          )}
        </span>
        <span className="font-mono text-[10px] text-paper/40">
          {events.length} steps
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-64 overflow-y-auto px-4 py-3 space-y-1.5 font-mono text-xs leading-relaxed"
      >
        {events.length === 0 && (
          <p className="text-paper/50 pulse-soft">Warming up…</p>
        )}
        {events.map((e, i) => (
          <p
            key={i}
            className={
              e.kind === 'thinking'
                ? 'text-paper/50 italic'
                : e.kind === 'search'
                  ? 'text-accent-wash'
                  : e.kind === 'error'
                    ? 'text-red-300'
                    : e.kind === 'done'
                      ? 'text-green-300'
                      : 'text-paper/75'
            }
          >
            <span className="select-none mr-2 text-paper/40">
              {TRACE_GLYPHS[e.kind] ?? '·'}
            </span>
            {e.text}
          </p>
        ))}
        {run.status === 'running' && (
          <p className="text-paper/40 pulse-soft select-none">▋</p>
        )}
      </div>
      {run.status === 'failed' && run.error && (
        <p className="px-4 py-2 border-t border-paper/15 text-xs text-red-300">
          {run.error} — you can retry with the buttons above.
        </p>
      )}
    </div>
  );
}

function FactBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint mb-1.5">
        {label}
      </p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function Faint({ children }: { children: React.ReactNode }) {
  return <span className="text-faint">{children}</span>;
}

function ClaimPanel({
  person,
  isClaimer,
  hasPendingClaim,
}: {
  person: PersonFull;
  isClaimer: boolean;
  hasPendingClaim: boolean;
}) {
  const { user } = useViewer();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRequest, setShowRequest] = useState(false);

  if (isClaimer) {
    return (
      <div className="border border-moss/40 bg-moss-wash/60 p-4">
        <p className="text-sm text-moss font-medium">This is your page.</p>
        <p className="text-xs text-ink-soft mt-1">
          Use Edit (top right) to correct anything.
        </p>
      </div>
    );
  }
  if (person.claimedBy) return null;

  if (!user) {
    return (
      <div className="border border-line bg-card p-4">
        <p className="font-display font-semibold mb-1">Is this you?</p>
        <p className="text-xs text-ink-soft mb-3">
          Sign in to claim this page and keep it accurate.
        </p>
        <Link
          href={`/login?next=/p/${person.slug}`}
          className="inline-block font-mono text-[10px] uppercase tracking-widest bg-ink text-paper px-3 py-1.5 hover:bg-accent transition-colors"
        >
          Sign in to claim
        </Link>
      </div>
    );
  }

  const emailMatches =
    !!person.email &&
    !!user.email &&
    person.email.trim().toLowerCase() === user.email.trim().toLowerCase();

  const autoClaim = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: user.refresh_token,
          personId: person.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Claim failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setBusy(false);
    }
  };

  const requestClaim = async () => {
    setBusy(true);
    setError(null);
    try {
      await db.transact(
        db.tx.claims[id()]
          .create({
            status: 'pending',
            requesterEmail: user.email ?? '',
            message,
            createdAt: Date.now(),
          })
          .link({ person: person.id, user: user.id }),
      );
      setShowRequest(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  if (hasPendingClaim) {
    return (
      <div className="border border-line bg-card p-4">
        <p className="text-sm font-medium">Claim requested</p>
        <p className="text-xs text-ink-soft mt-1">
          An admin will review your request to claim this page.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-line bg-card p-4">
      <p className="font-display font-semibold mb-1">Is this you?</p>
      {emailMatches ? (
        <>
          <p className="text-xs text-ink-soft mb-3">
            Your sign-in email matches this profile — claim it instantly.
          </p>
          <button
            onClick={autoClaim}
            disabled={busy}
            className="font-mono text-[10px] uppercase tracking-widest bg-accent text-paper px-3 py-1.5 hover:bg-accent-deep transition-colors disabled:opacity-50"
          >
            {busy ? 'Claiming…' : 'Claim this page'}
          </button>
        </>
      ) : showRequest ? (
        <div className="space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell the admins why this page is yours (links help)…"
            rows={3}
            className="w-full bg-paper border border-line px-2 py-1.5 text-xs outline-none focus:border-accent placeholder:text-faint"
          />
          <div className="flex gap-2">
            <button
              onClick={requestClaim}
              disabled={busy || !message.trim()}
              className="font-mono text-[10px] uppercase tracking-widest bg-ink text-paper px-3 py-1.5 hover:bg-accent transition-colors disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send request'}
            </button>
            <button
              onClick={() => setShowRequest(false)}
              className="font-mono text-[10px] uppercase tracking-widest text-faint hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-ink-soft mb-3">
            Request ownership and an admin will verify it’s you.
          </p>
          <button
            onClick={() => setShowRequest(true)}
            className="font-mono text-[10px] uppercase tracking-widest bg-ink text-paper px-3 py-1.5 hover:bg-accent transition-colors"
          >
            Request to claim
          </button>
        </>
      )}
      {error && <p className="mt-2 text-xs text-accent-deep">{error}</p>}
    </div>
  );
}

function EditForm({
  person,
  onClose,
}: {
  person: PersonFull;
  onClose: () => void;
}) {
  const [bio, setBio] = useState(person.bio ?? '');
  const [primaryOrg, setPrimaryOrg] = useState(person.primaryOrg ?? '');
  const [otherOrgs, setOtherOrgs] = useState(
    (person.otherOrgs ?? []).join(', '),
  );
  const [tags, setTags] = useState((person.tags ?? []).join(', '));
  const [summary, setSummary] = useState(person.profile?.summary ?? '');
  const [article, setArticle] = useState(person.profile?.article ?? '');
  const [links, setLinks] = useState(
    (person.profile?.links ?? [])
      .map((l) => `${l.label} | ${l.url}`)
      .join('\n'),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const splitList = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsedLinks = links
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [label, url] = line.includes('|')
            ? line.split('|').map((x) => x.trim())
            : [line, line];
          return { label, url: url || label };
        });

      const profileId = person.profile?.id ?? id();
      const txs = [
        db.tx.people[person.id].update({
          bio: bio.trim() || undefined,
          primaryOrg: primaryOrg.trim() || undefined,
          otherOrgs: splitList(otherOrgs),
          tags: splitList(tags),
          humanEdited: true,
          updatedAt: Date.now(),
        }),
        db.tx.profiles[profileId]
          .update({
            summary: summary.trim() || undefined,
            article: article.trim() || undefined,
            links: parsedLinks,
          })
          .link({ person: person.id }),
      ];
      await db.transact(txs);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const field =
    'w-full bg-card border border-line px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-faint';
  const label = 'font-mono text-[10px] uppercase tracking-[0.2em] text-faint';

  return (
    <div className="pt-8 max-w-3xl space-y-5">
      <div className="space-y-1.5">
        <p className={label}>One-sentence bio</p>
        <input
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className={field}
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <p className={label}>Primary org</p>
          <input
            value={primaryOrg}
            onChange={(e) => setPrimaryOrg(e.target.value)}
            className={field}
          />
        </div>
        <div className="space-y-1.5">
          <p className={label}>Other orgs (comma-separated)</p>
          <input
            value={otherOrgs}
            onChange={(e) => setOtherOrgs(e.target.value)}
            className={field}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <p className={label}>Field tags (comma-separated)</p>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="technical AI safety, EA fieldbuilding"
          className={field}
        />
      </div>
      <div className="space-y-1.5">
        <p className={label}>Summary (a couple of paragraphs, markdown)</p>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={5}
          className={field}
        />
      </div>
      <div className="space-y-1.5">
        <p className={label}>Article (wikipedia-style, markdown)</p>
        <textarea
          value={article}
          onChange={(e) => setArticle(e.target.value)}
          rows={18}
          className={`${field} font-mono text-xs leading-relaxed`}
        />
      </div>
      <div className="space-y-1.5">
        <p className={label}>Links (one per line: Label | URL)</p>
        <textarea
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          rows={4}
          placeholder={'Personal site | https://example.com\nTwitter | https://x.com/…'}
          className={`${field} font-mono text-xs`}
        />
      </div>
      {error && <p className="text-sm text-accent-deep">{error}</p>}
      <div className="flex gap-3 pb-8">
        <button
          onClick={save}
          disabled={busy}
          className="font-mono text-xs uppercase tracking-widest bg-ink text-paper px-5 py-2.5 hover:bg-accent transition-colors disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={onClose}
          className="font-mono text-xs uppercase tracking-widest text-faint hover:text-ink transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
