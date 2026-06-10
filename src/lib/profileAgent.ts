/**
 * Profile-generation agent, shared by the /api/generate route and the batch
 * script. Researches a person on the web with Claude + web search, then
 * extracts a structured wiki profile. Progress streams into a `runs` entity
 * as a trace, which the UI renders live via InstantDB sync.
 *
 * Two modes:
 *  - fast: Haiku 4.5, up to 3 searches, no thinking — quick first draft
 *  - deep: Opus 4.8, up to 10 searches, summarized thinking in the trace
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { init, id } from '@instantdb/admin';
import schema from '@/instant.schema';

export type GenerationMode = 'fast' | 'deep';

export const MODE_CONFIG: Record<
  GenerationMode,
  { model: string; maxSearches: number; label: string }
> = {
  fast: { model: 'claude-haiku-4-5', maxSearches: 3, label: 'Fast' },
  deep: { model: 'claude-opus-4-8', maxSearches: 10, label: 'Deep' },
};

let _db: ReturnType<typeof initDb> | null = null;
function initDb() {
  return init({
    appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
    adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
    schema,
  });
}
export function getAdminDb() {
  if (!_db) _db = initDb();
  return _db;
}

const anthropic = new Anthropic();

const ProfileSchema = z.object({
  found: z
    .boolean()
    .describe(
      'Whether you confidently identified this specific person online. False if results were too ambiguous or sparse.',
    ),
  bio: z
    .string()
    .describe(
      'One sentence describing who this person is and what they do. Empty string if not found.',
    ),
  summary: z
    .string()
    .describe(
      'Two to three paragraphs summarizing the person: role, background, notable work. Markdown. Empty if not found.',
    ),
  article: z
    .string()
    .describe(
      'A neutral, wikipedia-style article of roughly 800-1200 words in markdown with ## section headings (e.g. Career, Work in the field, Writing & public presence). Only include facts supported by the research. Empty if not found.',
    ),
  primaryOrg: z
    .string()
    .nullable()
    .describe('The organization they primarily work at, or null.'),
  otherOrgs: z
    .array(z.string())
    .describe('Other organizations they are affiliated with.'),
  tags: z
    .array(z.string())
    .describe(
      'Three to six short plaintext field-affiliation tags, lowercase, e.g. "technical AI safety", "EA fieldbuilding", "forecasting".',
    ),
  links: z
    .array(z.object({ label: z.string(), url: z.string() }))
    .describe(
      'Their most common web presences: personal site, X/Twitter, LinkedIn, GitHub, blog, org bio page. Only include URLs actually seen in search results.',
    ),
});

type ProfileData = z.infer<typeof ProfileSchema>;

type PersonForGen = {
  id: string;
  name: string;
  email?: string | null;
  context?: string | null;
  sources?: { description: string }[];
  profile?: { id: string } | null;
};

function researchPrompt(person: PersonForGen, maxSearches: number) {
  const sourceContext = (person.sources ?? [])
    .map((s) => `- Appears in: ${s.description}`)
    .join('\n');
  return `Research the person "${person.name}" on the web and write a dossier about them.

Context to help disambiguate which "${person.name}" this is:
${sourceContext || ''}
${person.context ? `- Provided context: ${person.context}` : ''}
${person.email ? `- Their email is ${person.email} (use only for disambiguation — never include it in your output)` : ''}
- They appear in a directory of people in the EA / AI safety / forecasting / adjacent communities, so prefer candidates connected to those fields.

Search the web (up to ${maxSearches} searches) to find:
1. Who they are: current role, primary organization, other affiliations.
2. Their work history and notable projects, writing, or research.
3. Their web presences: personal site, X/Twitter, LinkedIn, GitHub, blog, org bio.
4. Which sub-fields they belong to (e.g. technical AI safety, agent foundations, EA fieldbuilding, forecasting, biosecurity).

Then write a thorough dossier in plain text: every fact you found, a draft one-sentence bio, a 2-3 paragraph summary, and a draft ~1000-word wikipedia-style article in markdown with section headings. List all relevant URLs.

If you cannot confidently identify this specific person (results are ambiguous or there is nothing substantive online), say so explicitly and summarize what little you found instead.`;
}

type Tracer = (kind: string, text: string) => Promise<void>;

async function researchPerson(
  person: PersonForGen,
  mode: GenerationMode,
  trace: Tracer,
): Promise<string> {
  const config = MODE_CONFIG[mode];
  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: researchPrompt(person, config.maxSearches) },
  ];

  // Server-side web search can hit pause_turn; resume up to a few times
  for (let attempt = 0; attempt < 5; attempt++) {
    const stream = anthropic.messages.stream({
      model: config.model,
      max_tokens: 16000,
      ...(mode === 'deep'
        ? { thinking: { type: 'adaptive', display: 'summarized' } as const }
        : {}),
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: config.maxSearches,
          // Haiku doesn't support programmatic tool calling (dynamic
          // filtering), so fast mode calls search directly
          ...(mode === 'fast' ? { allowed_callers: ['direct'] as const } : {}),
        },
      ],
      messages,
    });

    stream.on('contentBlock', (block) => {
      if (block.type === 'server_tool_use' && block.name === 'web_search') {
        const query = (block.input as { query?: string })?.query;
        if (query) void trace('search', `Searching: “${query}”`);
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
      messages = [...messages, { role: 'assistant', content: message.content }];
      continue;
    }
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  throw new Error('Research did not complete after 5 continuations');
}

async function extractProfile(
  name: string,
  dossier: string,
  mode: GenerationMode,
): Promise<ProfileData> {
  const response = await anthropic.messages.parse({
    model: MODE_CONFIG[mode].model,
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: `Below is a research dossier about "${name}". Convert it into a structured wiki profile. Be faithful to the dossier — do not invent facts. Keep the article neutral and wikipedia-style, roughly 800-1200 words, markdown with ## headings. If the dossier says the person could not be confidently identified, set found=false and leave the text fields empty.

<dossier>
${dossier}
</dossier>`,
      },
    ],
    output_config: { format: zodOutputFormat(ProfileSchema) },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error('Failed to parse structured profile output');
  return parsed;
}

export class AlreadyRunningError extends Error {}

/**
 * Generate (or regenerate) one person's profile. Creates a `runs` entity and
 * streams trace events into it; resolves when the profile is written.
 */
export async function runProfileGeneration({
  personId,
  mode,
}: {
  personId: string;
  mode: GenerationMode;
}): Promise<{ runId: string; found: boolean }> {
  const db = getAdminDb();
  const { people } = await db.query({
    people: {
      $: { where: { id: personId } },
      profile: {},
      sources: {},
    },
  });
  const person = people[0] as PersonForGen & { status?: string };
  if (!person) throw new Error('Person not found');
  if (person.status === 'generating') {
    throw new AlreadyRunningError('A profile run is already in progress');
  }

  const runId = id();
  const events: { t: number; kind: string; text: string }[] = [];
  let lastFlush = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    lastFlush = Date.now();
    await db.transact(db.tx.runs[runId].update({ trace: [...events] }));
  };
  const trace: Tracer = async (kind, text) => {
    events.push({ t: Date.now(), kind, text });
    // Throttle writes to ~1/sec so rapid thinking chunks don't spam transacts
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

  const config = MODE_CONFIG[mode];
  await db.transact([
    db.tx.runs[runId]
      .create({
        mode,
        status: 'running',
        trace: [],
        createdAt: Date.now(),
      })
      .link({ person: personId }),
    db.tx.people[personId].update({ status: 'generating' }),
  ]);

  try {
    await trace(
      'status',
      `Starting ${config.label.toLowerCase()} research with ${config.model} (up to ${config.maxSearches} web searches)…`,
    );
    const dossier = await researchPerson(person, mode, trace);
    await trace('status', 'Research complete — writing the profile…');
    const profile = await extractProfile(person.name, dossier, mode);

    const profileId = person.profile?.id ?? id();
    const now = Date.now();
    await db.transact([
      db.tx.people[personId].update({
        status: 'generated',
        bio: profile.found ? profile.bio : undefined,
        primaryOrg: profile.primaryOrg ?? undefined,
        otherOrgs: profile.otherOrgs,
        tags: profile.tags,
        updatedAt: now,
      }),
      db.tx.profiles[profileId]
        .update({
          summary: profile.found ? profile.summary : undefined,
          article: profile.found
            ? profile.article
            : `*We could not confidently identify this person from public sources. If this is you, claim the profile and fill it in!*`,
          links: profile.links,
          generatedAt: now,
          model: config.model,
        })
        .link({ person: personId }),
    ]);
    await trace(
      'done',
      profile.found
        ? 'Profile written.'
        : 'Could not confidently identify this person — wrote a minimal page.',
    );
    if (flushTimer) clearTimeout(flushTimer);
    await db.transact(
      db.tx.runs[runId].update({
        status: 'done',
        finishedAt: Date.now(),
        trace: [...events],
      }),
    );
    return { runId, found: profile.found };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    events.push({ t: Date.now(), kind: 'error', text: message });
    if (flushTimer) clearTimeout(flushTimer);
    await db.transact([
      db.tx.runs[runId].update({
        status: 'failed',
        error: message,
        finishedAt: Date.now(),
        trace: [...events],
      }),
      db.tx.people[personId].update({ status: 'failed' }),
    ]);
    throw err;
  }
}
