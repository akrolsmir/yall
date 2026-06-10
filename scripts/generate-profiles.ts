/**
 * Batch profile generation for y'all (yall.bio).
 *
 * Usage:
 *   bun run generate                  # process everyone with status "queued"
 *   bun run generate -- --mode fast   # fast mode (haiku, fewer searches); default is deep
 *   bun run generate -- --limit 10    # cap the batch size
 *   bun run generate -- --slugs alice-smith,bob-jones   # specific people
 *   bun run generate -- --force       # also (re)generate non-queued profiles
 *                                     # (still skips human-edited/claimed ones)
 *   bun run generate -- --concurrency 4
 *
 * Requires ANTHROPIC_API_KEY, NEXT_PUBLIC_INSTANT_APP_ID, and
 * INSTANT_APP_ADMIN_TOKEN in .env (Bun loads .env automatically).
 */

import {
  getAdminDb,
  runProfileGeneration,
  MODE_CONFIG,
  GenerationMode,
} from '../src/lib/profileAgent';

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
  const mode = (getArg('--mode') ?? 'deep') as GenerationMode;

  if (!MODE_CONFIG[mode]) {
    console.error(`Unknown mode "${mode}" — use fast or deep`);
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY in .env');
    process.exit(1);
  }

  const db = getAdminDb();
  const where = slugs
    ? { slug: { $in: slugs } }
    : force
      ? { status: { $in: ['queued', 'generated', 'failed', 'none'] } }
      : { status: 'queued' };

  const { people } = await db.query({
    people: { $: { where }, claimedBy: {} },
  });

  const eligible = people
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
    `Generating ${eligible.length} profile(s) in ${mode} mode (${MODE_CONFIG[mode].model}), concurrency ${concurrency}${
      skipped ? ` (${skipped} skipped: human-edited or claimed)` : ''
    }\n`,
  );

  const queue = [...eligible];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const person = queue.shift();
        if (!person) continue;
        console.log(`→ ${person.name} (${person.slug}): researching…`);
        try {
          const { found } = await runProfileGeneration({
            personId: person.id,
            mode,
          });
          console.log(
            `✓ ${person.name}: ${found ? 'profiled' : 'not confidently found (minimal profile written)'}`,
          );
        } catch (err) {
          console.error(
            `✗ ${person.name}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }),
  );
  console.log('\nDone.');
}

main();
