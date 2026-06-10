/**
 * Matchmaking chat agent behind /chat. A tool-calling loop over the people
 * directory: Claude searches the index (`search_people`), deep-reads
 * candidates (`get_profile`), and researches warm intro paths on the web
 * (`web_search`). The assistant reply streams into a `messages` entity —
 * content and a tool trace update live via InstantDB sync, same pattern as
 * profile-generation `runs`.
 *
 * Two modes, mirroring profile generation:
 *  - fast: Sonnet 4.6 — quick interactive answers
 *  - deep: Opus 4.8 with thinking — thorough matching & research
 */

import Anthropic from '@anthropic-ai/sdk';
import { id } from '@instantdb/admin';
import { adminDb } from '@/lib/adminDb';

export type ChatMode = 'fast' | 'deep';

export const CHAT_MODE_CONFIG: Record<
  ChatMode,
  { model: string; maxWebSearches: number; maxTokens: number; label: string }
> = {
  fast: {
    model: 'claude-sonnet-4-6',
    maxWebSearches: 4,
    maxTokens: 8000,
    label: 'Fast',
  },
  deep: {
    model: 'claude-opus-4-8',
    maxWebSearches: 10,
    maxTokens: 16000,
    label: 'Deep',
  },
};

const MAX_AGENT_TURNS = 16;
const MAX_HISTORY_MESSAGES = 40;

const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Directory tools

const DIRECTORY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_people',
    description:
      'Search the y’all directory of people. Returns light rows (name, slug, one-sentence bio, primary org, tags). Run several searches with different terms to cover a listing’s requirements — each term in `query` must match somewhere in the person’s name, bio, orgs, or tags, so prefer one or two broad terms per call over one long query.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Space-separated keywords, case-insensitive, ANDed. Matched against name, bio, orgs, and tags. Omit to browse by tag/org only.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Field tags to require (substring match, e.g. "forecasting", "ai safety").',
        },
        org: {
          type: 'string',
          description: 'Require an org affiliation (substring match).',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default 25, max 50).',
        },
      },
    },
  },
  {
    name: 'get_profile',
    description:
      'Fetch one person’s full profile by slug: summary, wikipedia-style article, web links, and where they were sourced from. Use on shortlisted candidates before recommending them or drafting outreach, so claims about their work are grounded.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'The person’s slug, from search_people.' },
      },
      required: ['slug'],
    },
  },
];

type PersonLite = {
  id: string;
  name: string;
  slug: string;
  bio?: string | null;
  primaryOrg?: string | null;
  otherOrgs?: string[] | null;
  tags?: string[] | null;
  status: string;
};

async function searchPeople(input: {
  query?: string;
  tags?: string[];
  org?: string;
  limit?: number;
}): Promise<{ summary: string; result: unknown }> {
  // The whole index is light rows; filter in memory (fine at 10k+ people)
  const { people } = await adminDb.query({ people: {} });
  const all = people as PersonLite[];

  const terms = (input.query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const wantTags = (input.tags ?? []).map((t) => t.toLowerCase()).filter(Boolean);
  const wantOrg = input.org?.toLowerCase().trim();

  const matches = all.filter((p) => {
    const tags = (p.tags ?? []).map((t) => t.toLowerCase());
    const orgs = [p.primaryOrg ?? '', ...(p.otherOrgs ?? [])]
      .join(' • ')
      .toLowerCase();
    const haystack = [p.name, p.bio ?? '', orgs, tags.join(' ')]
      .join(' • ')
      .toLowerCase();
    if (!terms.every((t) => haystack.includes(t))) return false;
    if (!wantTags.every((w) => tags.some((t) => t.includes(w)))) return false;
    if (wantOrg && !orgs.includes(wantOrg)) return false;
    return true;
  });

  // Profiled people first — there is substance to read about them
  matches.sort((a, b) =>
    Number(b.status === 'generated') - Number(a.status === 'generated') ||
    a.name.localeCompare(b.name),
  );

  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const rows = matches.slice(0, limit).map((p) => ({
    name: p.name,
    slug: p.slug,
    bio: p.bio ?? null,
    primaryOrg: p.primaryOrg ?? null,
    tags: p.tags ?? [],
    hasFullProfile: p.status === 'generated',
  }));

  const desc = [
    input.query && `“${input.query}”`,
    wantTags.length && `tags: ${wantTags.join(', ')}`,
    wantOrg && `org: ${wantOrg}`,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    summary: `Directory search ${desc || '(browse all)'} — ${matches.length} match${matches.length === 1 ? '' : 'es'}`,
    result: {
      totalMatches: matches.length,
      returned: rows.length,
      directorySize: all.length,
      people: rows,
    },
  };
}

async function getProfile(input: {
  slug?: string;
}): Promise<{ summary: string; result: unknown }> {
  const slug = input.slug?.trim();
  if (!slug) return { summary: 'Profile lookup (missing slug)', result: { error: 'slug is required' } };
  const { people } = await adminDb.query({
    people: {
      $: { where: { slug } },
      profile: {},
      sources: {},
      claimedBy: {},
    },
  });
  const person = people[0];
  if (!person) {
    return {
      summary: `Profile “${slug}” — not found`,
      result: { error: `No person with slug "${slug}"` },
    };
  }
  return {
    summary: `Read profile: ${person.name}`,
    result: {
      name: person.name,
      slug: person.slug,
      profileUrl: `/p/${person.slug}`,
      bio: person.bio ?? null,
      primaryOrg: person.primaryOrg ?? null,
      otherOrgs: person.otherOrgs ?? [],
      tags: person.tags ?? [],
      summary: person.profile?.summary ?? null,
      article: person.profile?.article ?? null,
      links: person.profile?.links ?? [],
      sourcedFrom: (person.sources ?? []).map((s) => s.description),
      claimedBySubject: !!person.claimedBy,
      humanEdited: person.humanEdited ?? false,
    },
  };
}

// ---------------------------------------------------------------------------
// System prompt

type ViewerContext = {
  email: string | null;
  claimed: {
    name: string;
    slug: string;
    bio?: string | null;
    primaryOrg?: string | null;
    summary?: string | null;
    links?: { label: string; url: string }[] | null;
  } | null;
  voice: {
    styleNotes?: string | null;
    writingSamples?: string | null;
    network?: string | null;
  } | null;
};

function systemPrompt(viewer: ViewerContext, mode: ChatMode): string {
  const sections: string[] = [];

  sections.push(`You are the concierge for y’all (yall.bio), a public wiki/directory of people in the EA / AI safety / forecasting / adjacent communities. You help the signed-in user work with the directory. Your three specialties:

1. **Matching a listing.** The user pastes a job listing, call for conference speakers, grant round, etc. You search the directory from several angles (run search_people multiple times with different terms), read the full profiles of the most promising candidates with get_profile, then present a ranked shortlist as a markdown table — columns like Name, Why they fit, Org, Fields — with each name linked as [Name](/p/slug). Be honest: flag weak matches as weak, and say so plainly if the directory has nobody suitable.

2. **Drafting outreach.** You write outreach messages to a specific candidate in the user's own voice (see "About the user" below — mirror their style notes and writing samples; if there are none, default to warm, brief, and concrete, and skip the flattery). Ground every claim about the candidate in their actual profile (get_profile first) — never invent familiarity with work you haven't verified. Keep drafts short and specific about the ask. Offer the draft in a markdown blockquote or code block so it's easy to copy.

3. **Finding a thoughtful path to someone.** When the user wants to reach a specific person, figure out the warmest route: cross-reference the user's stated network against the candidate; read the candidate's profile and links; and use web_search to find collaborators, co-authors, podcast appearances, or shared communities that could carry an intro. Recommend a concrete plan (who to ask for an intro, or which channel and what hook), not just facts.`);

  sections.push(`Tool guidance:
- search_people is cheap — prefer several narrow searches over one broad one. Results are ANDed keywords, so "ai policy" only matches people whose row contains both words.
- get_profile before making any substantive claim about a person.
- web_search is for the wider web: a person's recent work, mutual connections, or anything not in the directory. You have at most ${CHAT_MODE_CONFIG[mode].maxWebSearches} web searches per reply — spend them on the highest-value questions.
- Always link directory people as [Name](/p/slug) (relative links, no domain). Use GFM markdown tables for 3+ candidates.
- People with hasFullProfile=false only have a stub row — you can still suggest them, but say the directory knows little about them.
- Profiles are largely AI-drafted from public sources and may contain errors; treat claimedBySubject/humanEdited profiles as more reliable.
- Never reveal email addresses, even if asked.`);

  const user: string[] = [];
  user.push(`Signed in as ${viewer.email ?? 'an anonymous user'}.`);
  if (viewer.claimed) {
    const c = viewer.claimed;
    user.push(
      `They have claimed the directory profile [${c.name}](/p/${c.slug})${c.primaryOrg ? ` (${c.primaryOrg})` : ''}${c.bio ? ` — ${c.bio}` : ''}.${c.summary ? `\nTheir profile summary:\n${c.summary}` : ''}${c.links?.length ? `\nTheir links: ${c.links.map((l) => `${l.label}: ${l.url}`).join(', ')}` : ''}`,
    );
  }
  if (viewer.voice?.styleNotes?.trim()) {
    user.push(`Their voice & style notes:\n${viewer.voice.styleNotes.trim()}`);
  }
  if (viewer.voice?.writingSamples?.trim()) {
    user.push(
      `Samples of their writing (mimic this voice when drafting outreach):\n<writing_samples>\n${viewer.voice.writingSamples.trim()}\n</writing_samples>`,
    );
  }
  if (viewer.voice?.network?.trim()) {
    user.push(
      `People and communities they say they know well (use for warm-intro paths):\n${viewer.voice.network.trim()}`,
    );
  }
  if (!viewer.voice?.styleNotes?.trim() && !viewer.voice?.writingSamples?.trim()) {
    user.push(
      `They have not saved a voice profile yet. If they ask for outreach in their voice, draft something good anyway and mention they can save style notes & writing samples under “Voice” on the chat page to make future drafts sound like them.`,
    );
  }
  sections.push(`About the user:\n${user.join('\n\n')}`);

  sections.push(
    `Today's date: ${new Date().toISOString().slice(0, 10)}. Keep replies tight — lead with the useful thing, not a preamble.`,
  );

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// The agent loop

export class ChatBusyError extends Error {}

async function loadViewerContext(userId: string): Promise<ViewerContext> {
  const { $users } = await adminDb.query({
    $users: {
      $: { where: { id: userId } },
      voiceProfile: {},
      claimedPeople: { profile: {} },
    },
  });
  const u = $users[0];
  const claimedPerson = u?.claimedPeople?.[0];
  return {
    email: u?.email ?? null,
    claimed: claimedPerson
      ? {
          name: claimedPerson.name,
          slug: claimedPerson.slug,
          bio: claimedPerson.bio,
          primaryOrg: claimedPerson.primaryOrg,
          summary: claimedPerson.profile?.summary,
          links: claimedPerson.profile?.links,
        }
      : null,
    voice: u?.voiceProfile ?? null,
  };
}

/**
 * Run one assistant turn for a chat: creates a streaming `messages` entity,
 * loops Claude over the directory/web tools, and flushes content + trace to
 * InstantDB as it goes. Resolves when the reply is complete.
 */
export async function runChatTurn({
  chatId,
  userId,
  mode,
}: {
  chatId: string;
  userId: string;
  mode: ChatMode;
}): Promise<{ messageId: string }> {
  const config = CHAT_MODE_CONFIG[mode];

  const { chats } = await adminDb.query({
    chats: {
      $: { where: { id: chatId } },
      owner: {},
      messages: { $: { order: { createdAt: 'asc' } } },
    },
  });
  const chat = chats[0];
  if (!chat) throw new Error('Chat not found');
  if (chat.owner?.id !== userId) throw new Error('Not your chat');

  const history = (chat.messages ?? []).filter(
    (m) => m.content.trim() && m.status !== 'failed',
  );
  if (history.some((m) => m.status === 'streaming')) {
    throw new ChatBusyError('A reply is already being written in this chat');
  }
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    throw new Error('Chat has no pending user message');
  }

  const viewer = await loadViewerContext(userId);

  // --- streaming state, flushed to the message entity ~1/sec (runs pattern)
  const messageId = id();
  let content = '';
  const events: { t: number; kind: string; text: string }[] = [];
  let lastFlush = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    lastFlush = Date.now();
    await adminDb.transact(
      adminDb.tx.messages[messageId].update({ content, trace: [...events] }),
    );
  };
  const bump = async () => {
    if (Date.now() - lastFlush > 1000) {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      await flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
      }, 1000);
    }
  };
  const trace = async (kind: string, text: string) => {
    events.push({ t: Date.now(), kind, text });
    await bump();
  };

  await adminDb.transact(
    adminDb.tx.messages[messageId]
      .create({
        role: 'assistant',
        content: '',
        status: 'streaming',
        model: config.model,
        trace: [],
        createdAt: Date.now(),
      })
      .link({ chat: chatId }),
  );

  try {
    let messages: Anthropic.MessageParam[] = history
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const tools: Anthropic.ToolUnion[] = [
      ...DIRECTORY_TOOLS,
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: config.maxWebSearches,
      },
    ];

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      let needsBreak = content.length > 0;
      const stream = anthropic.messages.stream({
        model: config.model,
        max_tokens: config.maxTokens,
        system: systemPrompt(viewer, mode),
        ...(mode === 'deep'
          ? { thinking: { type: 'adaptive', display: 'summarized' } as const }
          : {}),
        tools,
        messages,
      });

      stream.on('text', (delta) => {
        if (needsBreak) {
          needsBreak = false;
          if (!/\n\s*$/.test(content)) content += '\n\n';
        }
        content += delta;
        void bump();
      });
      stream.on('contentBlock', (block) => {
        if (block.type === 'server_tool_use' && block.name === 'web_search') {
          const query = (block.input as { query?: string })?.query;
          if (query) void trace('search', `Web search: “${query}”`);
        } else if (block.type === 'web_search_tool_result') {
          const results = Array.isArray(block.content) ? block.content : [];
          const titles = results
            .slice(0, 3)
            .map((r) => ('title' in r ? r.title : null))
            .filter(Boolean);
          void trace(
            'results',
            titles.length
              ? `Found ${results.length} results — ${titles.join(' · ')}`
              : 'No useful results',
          );
        } else if (block.type === 'thinking' && block.thinking?.trim()) {
          void trace('thinking', block.thinking.trim());
        }
      });

      const message = await stream.finalMessage();

      if (message.stop_reason === 'pause_turn') {
        messages = [
          ...messages,
          { role: 'assistant', content: message.content },
        ];
        continue;
      }

      if (message.stop_reason === 'tool_use') {
        const toolUses = message.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          let out: { summary: string; result: unknown };
          try {
            if (tu.name === 'search_people') {
              out = await searchPeople(tu.input as Parameters<typeof searchPeople>[0]);
            } else if (tu.name === 'get_profile') {
              out = await getProfile(tu.input as Parameters<typeof getProfile>[0]);
            } else {
              out = { summary: `Unknown tool ${tu.name}`, result: { error: `Unknown tool: ${tu.name}` } };
            }
          } catch (err) {
            out = {
              summary: `${tu.name} failed`,
              result: { error: err instanceof Error ? err.message : 'Tool failed' },
            };
          }
          await trace('tool', out.summary);
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(out.result),
          });
        }
        messages = [
          ...messages,
          { role: 'assistant', content: message.content },
          { role: 'user', content: results },
        ];
        continue;
      }

      break; // end_turn / max_tokens — whatever streamed is the reply
    }

    if (!content.trim()) {
      content = '*I came up empty on that one — try rephrasing?*';
    }
    if (flushTimer) clearTimeout(flushTimer);
    await adminDb.transact([
      adminDb.tx.messages[messageId].update({
        content,
        trace: [...events],
        status: 'done',
      }),
      adminDb.tx.chats[chatId].update({ updatedAt: Date.now() }),
    ]);
    return { messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reply failed';
    events.push({ t: Date.now(), kind: 'error', text: message });
    if (flushTimer) clearTimeout(flushTimer);
    await adminDb.transact(
      adminDb.tx.messages[messageId].update({
        content,
        trace: [...events],
        status: 'failed',
        error: message,
      }),
    );
    throw err;
  }
}
