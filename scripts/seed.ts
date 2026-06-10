/**
 * Seed y'all with the initial list of people.
 * Usage: bun run seed
 */

import { init, id } from '@instantdb/admin';
import schema from '../src/instant.schema';
import { slugify } from '../src/lib/slug';

const db = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

const SEED_PEOPLE = [
  'Austin Chen',
  'Rachel Weinberg',
  'Oliver Habryka',
  'Rachel Shu',
];

async function main() {
  const { sources } = await db.query({
    sources: { $: { where: { description: 'Initial seed list' } } },
  });
  let sourceId = sources[0]?.id;
  if (!sourceId) {
    sourceId = id();
    await db.transact(
      db.tx.sources[sourceId].create({
        description: 'Initial seed list',
        createdAt: Date.now(),
      }),
    );
  }

  const { people: existing } = await db.query({ people: {} });
  const existingSlugs = new Set(existing.map((p) => p.slug));

  const txs = [];
  for (const name of SEED_PEOPLE) {
    const slug = slugify(name);
    if (existingSlugs.has(slug)) {
      console.log(`= ${name} already exists (${slug})`);
      continue;
    }
    txs.push(
      db.tx.people[id()]
        .create({
          name,
          slug,
          status: 'none',
          createdAt: Date.now(),
        })
        .link({ sources: sourceId }),
    );
    console.log(`+ ${name} → /p/${slug}`);
  }
  if (txs.length) await db.transact(txs);
  console.log('Seed complete.');
}

main();
