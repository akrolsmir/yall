/**
 * Batch profile generation for Bagel.
 *
 * Researches each queued person on the web with Claude + web search, then
 * writes their profile (bio, summary, article, links, structured data) back
 * to InstantDB.
 *
 * Usage:
 *   bun run generate                 # process everyone with status "queued"
 *   bun run generate -- --limit 10   # cap the batch size
 *   bun run generate -- --slugs alice-smith,bob-jones   # specific people
 *   bun run generate -- --force      # also regenerate "generated" profiles
 *                                    # (still skips human-edited/claimed ones)
 *   bun run generate -- --concurrency 4
 *
 * Requires ANTHROPIC_API_KEY, NEXT_PUBLIC_INSTANT_APP_ID, and
 * INSTANT_APP_ADMIN_TOKEN in .env (Bun loads .env automatically).
 */

import { init, id } from '@instantdb/admin';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import schema from '../src/instant.schema';

const MODEL = process.env.PROFILE_MODEL ?? 'claude-opus-4-8';
const MAX_SEARCHES_PER_PERSON = 8;

const db = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

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
      'A neutral, wikipedia-style article of roughly 800-1200 words in markdown with ## section headings (e.g. Career, Work in the field, Writing & public presence). Only include facts supported by your research. Empty if not found.',
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
      'Their most common web presences: personal site, X/Twitter, LinkedIn, GitHub, blog, org bio page. Only include URLs you actually saw in search results.',
    ),
});

type ProfileData = z.infer<typeof ProfileSchema>;

function researchPrompt(person: {
  name: string;
  email?: string | null;
  sources?: { description: string }[];
}) {
  const context = (person.sources ?? [])
    .map((s) => `- ${s.description}`)
    .join('\n');
  return `Research the person "${person.name}" on the web and write a dossier about them.

Context to help disambiguate which "${person.name}" this is:
${context || '- (no source context available)'}
${person.email ? `- Their email is ${person.email} (use only for disambiguation — never include it in your output)` : ''}
- They appear in a directory of people in the EA / AI safety / forecasting / adjacent communities, so prefer candidates connected to those fields.

Search the web (multiple searches as needed) to find:
1. Who they are: current role, primary organization, other affiliations.
2. Their work history and notable projects, writing, or research.
3. Their web presences: personal site, X/Twitter, LinkedIn, GitHub, blog, org bio.
4. Which sub-fields they belong to (e.g. technical AI safety, agent foundations, EA fieldbuilding, forecasting, biosecurity).

Then write a thorough dossier in plain text: every fact you found with where it came from, a draft one-sentence bio, a 2-3 paragraph summary, and a draft ~1000-word wikipedia-style article in markdown with section headings. List all relevant URLs.

If you cannot confidently identify this specific person (results are ambiguous or there is nothing substantive online), say so explicitly and summarize what little you found instead.`;
}

async function researchPerson(prompt: string): Promise<string> {
  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt },
  ];
  // Server-side web search loop can hit pause_turn; resume up to a few times
  for (let attempt = 0; attempt < 5; attempt++) {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: MAX_SEARCHES_PER_PERSON,
        },
      ],
      messages,
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
): Promise<ProfileData> {
  const response = await anthropic.messages.parse({
    model: MODEL,
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

type QueuedPerson = {
  id: string;
  name: string;
  slug: string;
  email?: string | null;
  humanEdited?: boolean | null;
  profile?: { id: string } | null;
  claimedBy?: { id: string } | null;
  sources?: { description: string }[];
};

async function processPerson(person: QueuedPerson) {
  console.log(`→ ${person.name} (${person.slug}): researching…`);
  await db.transact(db.tx.people[person.id].update({ status: 'generating' }));
  try {
    const dossier = await researchPerson(researchPrompt(person));
    const profile = await extractProfile(person.name, dossier);

    const profileId = person.profile?.id ?? id();
    const now = Date.now();
    await db.transact([
      db.tx.people[person.id].update({
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
          model: MODEL,
        })
        .link({ person: person.id }),
    ]);
    console.log(
      `✓ ${person.name}: ${profile.found ? 'profiled' : 'not confidently found (minimal profile written)'}`,
    );
  } catch (err) {
    console.error(`✗ ${person.name}:`, err instanceof Error ? err.message : err);
    await db.transact(db.tx.people[person.id].update({ status: 'failed' }));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const force = args.includes('--force');
  const limit = Number(getArg('--limit') ?? Infinity);
  const concurrency = Number(getArg('--concurrency') ?? 3);
  const slugs = getArg('--slugs')?.split(',').map((s) => s.trim());

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY in .env');
    process.exit(1);
  }

  const where = slugs
    ? { slug: { $in: slugs } }
    : force
      ? { status: { $in: ['queued', 'generated', 'failed', 'none'] } }
      : { status: 'queued' };

  const { people } = await db.query({
    people: {
      $: { where },
      profile: {},
      claimedBy: {},
      sources: {},
    },
  });

  const eligible = (people as QueuedPerson[])
    .filter((p) => !p.humanEdited && !p.claimedBy)
    .slice(0, limit);
  const skipped = people.length - eligible.length;

  if (!eligible.length) {
    console.log(
      `Nothing to do${skipped ? ` (${skipped} skipped: human-edited or claimed)` : ''}. Queue people from /admin first.`,
    );
    return;
  }
  console.log(
    `Generating ${eligible.length} profile(s) with ${MODEL}, concurrency ${concurrency}${
      skipped ? ` (${skipped} skipped: human-edited or claimed)` : ''
    }\n`,
  );

  // Simple worker pool
  const queue = [...eligible];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const person = queue.shift();
        if (person) await processPerson(person);
      }
    }),
  );
  console.log('\nDone.');
}

main();
