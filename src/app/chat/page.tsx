'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { id, InstaQLEntity } from '@instantdb/react';
import { db } from '@/lib/db';
import { useViewer } from '@/lib/useViewer';
import { AppSchema } from '@/instant.schema';

type Chat = InstaQLEntity<AppSchema, 'chats'>;
type Message = InstaQLEntity<AppSchema, 'messages'>;
type VoiceProfile = InstaQLEntity<AppSchema, 'voiceProfiles'>;
type ChatMode = 'fast' | 'deep';

const SUGGESTIONS: { title: string; blurb: string; prefill: string }[] = [
  {
    title: 'Match a listing',
    blurb:
      'Paste a job listing, CFP, or grant round — get a shortlist from the directory.',
    prefill:
      'Here’s a listing — find me the best matches in the directory and explain why each fits:\n\n',
  },
  {
    title: 'Draft outreach',
    blurb: 'Write to a candidate in your own voice, grounded in their work.',
    prefill:
      'Draft an outreach message in my voice to NAME about THE ASK. Read their profile first.',
  },
  {
    title: 'Find a warm path',
    blurb: 'The most thoughtful way to reach someone — shared contacts, hooks.',
    prefill:
      'What’s the most thoughtful way for me to reach NAME? Check who I know, their profile, and the web for mutual connections or a good hook.',
  },
];

export default function ChatPage() {
  const viewer = useViewer();
  const [chatId, setChatId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<ChatMode>('fast');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showVoice, setShowVoice] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: chatsData } = db.useQuery(
    viewer.user
      ? { chats: { $: { order: { updatedAt: 'desc' } } } }
      : null,
  );
  const { data: messagesData } = db.useQuery(
    viewer.user && chatId
      ? {
          messages: {
            $: { where: { 'chat.id': chatId }, order: { createdAt: 'asc' } },
          },
        }
      : null,
  );
  // Perms scope voiceProfiles to the owner, so this is mine or empty
  const { data: voiceData } = db.useQuery(
    viewer.user ? { voiceProfiles: {} } : null,
  );

  const chats = (chatsData?.chats ?? []) as Chat[];
  const messages = (messagesData?.messages ?? []) as Message[];
  const voice = (voiceData?.voiceProfiles?.[0] ?? null) as VoiceProfile | null;

  const lastMessage = messages[messages.length - 1];
  const busy =
    sending || (!!chatId && lastMessage?.status === 'streaming');

  const callAgent = async (cid: string, sendMode: ChatMode) => {
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: viewer.user!.refresh_token,
          chatId: cid,
          mode: sendMode,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'The assistant failed to reply');
      }
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : 'The assistant failed to reply',
      );
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !viewer.user) return;
    setSendError(null);
    const now = Date.now();
    let cid = chatId;
    const txs = [];
    if (!cid) {
      cid = id();
      const title = text.length > 64 ? `${text.slice(0, 64).trimEnd()}…` : text;
      txs.push(
        db.tx.chats[cid]
          .create({ title, createdAt: now, updatedAt: now })
          .link({ owner: viewer.user.id }),
      );
    } else {
      txs.push(db.tx.chats[cid].update({ updatedAt: now }));
    }
    txs.push(
      db.tx.messages[id()]
        .create({ role: 'user', content: text, status: 'done', createdAt: now })
        .link({ chat: cid }),
    );
    try {
      await db.transact(txs);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send');
      return;
    }
    setChatId(cid);
    setDraft('');
    void callAgent(cid, mode);
  };

  const deleteChat = async (c: Chat) => {
    // Messages cascade via the messageChat link
    await db.transact(db.tx.chats[c.id].delete());
    if (chatId === c.id) setChatId(null);
  };

  if (viewer.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-6 pt-16 pulse-soft">
        <div className="h-8 w-64 bg-paper-deep rounded-sm mb-3" />
        <div className="h-4 w-96 bg-paper-deep rounded-sm" />
      </div>
    );
  }

  if (!viewer.user) {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-24 text-center">
        <h1 className="font-display text-4xl font-semibold mb-3">
          Chat with the directory
        </h1>
        <p className="text-ink-soft mb-8">
          Paste a listing and get matched candidates, draft outreach in your
          own voice, or find the warmest path to someone — powered by AI over
          everyone in the index.
        </p>
        <Link
          href="/login?next=/chat"
          className="inline-block font-mono text-xs uppercase tracking-widest bg-ink text-paper px-5 py-2.5 hover:bg-accent transition-colors"
        >
          Sign in to start
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6">
      <div className="grid md:grid-cols-[230px_1fr] gap-0 h-[calc(100vh-3.5rem)]">
        {/* Sidebar */}
        <aside className="hidden md:flex flex-col border-r border-line py-5 pr-4 min-h-0">
          <button
            onClick={() => {
              setChatId(null);
              setSendError(null);
              inputRef.current?.focus();
            }}
            className="font-mono text-[10px] uppercase tracking-widest bg-ink text-paper px-3 py-2 hover:bg-accent transition-colors text-left"
          >
            + New conversation
          </button>
          <div className="mt-4 flex-1 overflow-y-auto min-h-0 space-y-0.5">
            {chats.length === 0 && (
              <p className="text-xs text-faint pt-2">
                Your conversations will appear here.
              </p>
            )}
            {chats.map((c) => (
              <div
                key={c.id}
                className={`group flex items-start gap-1 border-l-2 pl-2 pr-1 py-1.5 cursor-pointer transition-colors ${
                  c.id === chatId
                    ? 'border-accent bg-accent-wash/50'
                    : 'border-transparent hover:bg-paper-deep'
                }`}
                onClick={() => {
                  setChatId(c.id);
                  setSendError(null);
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug truncate">{c.title}</p>
                  <p className="font-mono text-[10px] text-faint mt-0.5">
                    {new Date(c.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteChat(c);
                  }}
                  title="Delete conversation"
                  className="opacity-0 group-hover:opacity-100 text-faint hover:text-accent-deep px-1 transition-opacity"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowVoice(true)}
            className="mt-4 border border-line bg-card px-3 py-2.5 text-left hover:border-accent transition-colors"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
              ✎ Your voice
            </span>
            <span className="block text-[11px] text-faint mt-0.5">
              {voice?.styleNotes || voice?.writingSamples
                ? 'Style & network saved'
                : 'Teach the AI how you write'}
            </span>
          </button>
        </aside>

        {/* Thread */}
        <main className="flex flex-col min-h-0 md:pl-8">
          {messages.length === 0 ? (
            <EmptyState
              onPick={(prefill) => {
                setDraft(prefill);
                inputRef.current?.focus();
              }}
            />
          ) : (
            <Thread
              messages={messages}
              onRetry={() => chatId && void callAgent(chatId, mode)}
            />
          )}

          {/* Composer */}
          <div className="pb-5 pt-3 border-t border-line">
            {sendError && (
              <p className="text-xs text-accent-deep mb-2">{sendError}</p>
            )}
            <div className="border border-line bg-card focus-within:border-accent transition-colors">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Paste a listing, name a candidate, or ask who to talk to…"
                rows={Math.min(8, Math.max(2, draft.split('\n').length))}
                className="w-full bg-transparent px-4 pt-3 pb-1 text-[15px] outline-none resize-none placeholder:text-faint"
              />
              <div className="flex items-center justify-between px-3 pb-2.5">
                <div className="inline-flex border border-line">
                  {(['fast', 'deep'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      title={
                        m === 'fast'
                          ? 'Sonnet — quick answers, a few searches'
                          : 'Opus with extended thinking — thorough matching & research'
                      }
                      className={`font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 transition-colors ${
                        mode === m
                          ? 'bg-ink text-paper'
                          : 'text-faint hover:text-ink'
                      }`}
                    >
                      {m === 'fast' ? '⚡ Fast' : '◉ Deep'}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => void send()}
                  disabled={busy || !draft.trim()}
                  className="font-mono text-[10px] uppercase tracking-widest bg-accent text-paper px-4 py-1.5 hover:bg-accent-deep transition-colors disabled:opacity-40"
                >
                  {busy ? 'Thinking…' : 'Send ↵'}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {showVoice && (
        <VoicePanel
          voice={voice}
          userId={viewer.user.id}
          onClose={() => setShowVoice(false)}
        />
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (prefill: string) => void }) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0 flex flex-col justify-center py-10">
      <div className="rise-in">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-faint mb-2">
          AI concierge
        </p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight leading-tight">
          Who are you
          <br />
          looking for?
        </h1>
        <p className="mt-3 text-ink-soft max-w-md">
          An assistant that knows everyone in the index — and can search the
          web for the rest.
        </p>
        <div className="mt-8 grid sm:grid-cols-3 gap-3 max-w-3xl">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.title}
              onClick={() => onPick(s.prefill)}
              className="text-left border border-line bg-card p-4 hover:border-accent hover:-translate-y-0.5 transition-all"
            >
              <p className="font-display font-semibold mb-1">{s.title}</p>
              <p className="text-xs text-ink-soft leading-relaxed">{s.blurb}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Thread({
  messages,
  onRetry,
}: {
  messages: Message[];
  onRetry: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, last?.content?.length, last?.trace?.length]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 py-6 space-y-6">
      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] bg-ink text-paper px-4 py-3 text-[15px] whitespace-pre-wrap">
              {m.content}
            </div>
          </div>
        ) : (
          <AssistantMessage key={m.id} message={m} onRetry={onRetry} />
        ),
      )}
    </div>
  );
}

const TRACE_GLYPHS: Record<string, string> = {
  tool: '⌕',
  search: '☉',
  results: '≡',
  thinking: '…',
  error: '✗',
};

function AssistantMessage({
  message,
  onRetry,
}: {
  message: Message;
  onRetry: () => void;
}) {
  const events = message.trace ?? [];
  const streaming = message.status === 'streaming';

  return (
    <div className="max-w-none">
      {events.length > 0 &&
        (streaming ? (
          <div className="mb-3 border border-line bg-ink text-paper/80 px-3 py-2 max-h-36 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1">
            {events.slice(-12).map((e, i) => (
              <p
                key={i}
                className={
                  e.kind === 'thinking'
                    ? 'text-paper/45 italic'
                    : e.kind === 'error'
                      ? 'text-red-300'
                      : 'text-paper/75'
                }
              >
                <span className="select-none mr-2 text-paper/40">
                  {TRACE_GLYPHS[e.kind] ?? '·'}
                </span>
                {e.text}
              </p>
            ))}
            <p className="text-paper/40 pulse-soft select-none">▋</p>
          </div>
        ) : (
          <details className="mb-2 group">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-faint hover:text-ink list-none">
              <span className="group-open:hidden">
                ▸ {events.length} research steps
              </span>
              <span className="hidden group-open:inline">
                ▾ {events.length} research steps
              </span>
            </summary>
            <div className="mt-2 border border-line bg-ink text-paper/80 px-3 py-2 max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1">
              {events.map((e, i) => (
                <p
                  key={i}
                  className={
                    e.kind === 'thinking'
                      ? 'text-paper/45 italic'
                      : e.kind === 'error'
                        ? 'text-red-300'
                        : 'text-paper/75'
                  }
                >
                  <span className="select-none mr-2 text-paper/40">
                    {TRACE_GLYPHS[e.kind] ?? '·'}
                  </span>
                  {e.text}
                </p>
              ))}
            </div>
          </details>
        ))}

      {message.content ? (
        <div className="prose-article prose-chat text-[15px]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) =>
                href?.startsWith('/') ? (
                  <Link href={href}>{children}</Link>
                ) : (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
            }}
          >
            {message.content}
          </ReactMarkdown>
          {streaming && <span className="pulse-soft select-none">▋</span>}
        </div>
      ) : streaming && events.length === 0 ? (
        <p className="text-faint pulse-soft text-sm">Thinking…</p>
      ) : null}

      {message.status === 'failed' && (
        <div className="mt-2 flex items-center gap-3">
          <p className="text-xs text-accent-deep">
            {message.error || 'The reply failed.'}
          </p>
          <button
            onClick={onRetry}
            className="font-mono text-[10px] uppercase tracking-widest border border-accent text-accent px-2 py-0.5 hover:bg-accent hover:text-paper transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function VoicePanel({
  voice,
  userId,
  onClose,
}: {
  voice: VoiceProfile | null;
  userId: string;
  onClose: () => void;
}) {
  const [styleNotes, setStyleNotes] = useState(voice?.styleNotes ?? '');
  const [writingSamples, setWritingSamples] = useState(
    voice?.writingSamples ?? '',
  );
  const [network, setNetwork] = useState(voice?.network ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await db.transact(
        db.tx.voiceProfiles[voice?.id ?? id()]
          .update({
            styleNotes: styleNotes.trim(),
            writingSamples: writingSamples.trim(),
            network: network.trim(),
            updatedAt: Date.now(),
          })
          .link({ owner: userId }),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const label = 'font-mono text-[10px] uppercase tracking-[0.2em] text-faint';
  const field =
    'w-full bg-paper border border-line px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-faint resize-y';

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full max-w-md bg-card border-l border-line p-6 overflow-y-auto rise-in">
        <div className="flex items-start justify-between mb-1">
          <h2 className="font-display text-2xl font-semibold">Your voice</h2>
          <button
            onClick={onClose}
            className="text-faint hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-ink-soft mb-6">
          Used when the AI drafts outreach as you, and to find warm intro
          paths through people you know. Only you can see this.
        </p>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <p className={label}>Style notes</p>
            <textarea
              value={styleNotes}
              onChange={(e) => setStyleNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Casual but direct. Lowercase greetings. No exclamation marks. Always lead with the ask."
              className={field}
            />
          </div>
          <div className="space-y-1.5">
            <p className={label}>Writing samples</p>
            <textarea
              value={writingSamples}
              onChange={(e) => setWritingSamples(e.target.value)}
              rows={9}
              placeholder="Paste a couple of emails or DMs you’ve actually sent — the AI will mimic the voice, not the content."
              className={field}
            />
          </div>
          <div className="space-y-1.5">
            <p className={label}>Who you know</p>
            <textarea
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
              rows={5}
              placeholder={
                'People and communities you can ask for intros, one per line:\nJane Doe — former colleague at Acme\nThe Manifest crowd\n…'
              }
              className={field}
            />
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-accent-deep">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="font-mono text-xs uppercase tracking-widest bg-ink text-paper px-5 py-2.5 hover:bg-accent transition-colors disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="font-mono text-xs uppercase tracking-widest text-faint hover:text-ink transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
