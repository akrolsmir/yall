import { NextRequest, NextResponse } from 'next/server';
import { id } from '@instantdb/admin';
import { adminDb } from '@/lib/adminDb';
import { slugify } from '@/lib/slug';

const MANUAL_SOURCE = 'Added individually via search';

// Anyone can add a person to the index (people.create is admin-only by perms,
// so creation is validated and performed here with the admin SDK).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name ?? '').trim();
    const context = String(body.context ?? '').trim();
    if (!name || name.length > 120) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }
    if (context.length > 500) {
      return NextResponse.json({ error: 'Context too long' }, { status: 400 });
    }

    const base = slugify(name);
    if (!base) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }

    // Suffix the slug if this name is already taken (intentional duplicates
    // are allowed — different people can share a name)
    const { people: colliding } = await adminDb.query({
      people: { $: { where: { slug: { $like: `${base}%` } } } },
    });
    const taken = new Set(colliding.map((p) => p.slug));
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

    const { sources } = await adminDb.query({
      sources: { $: { where: { description: MANUAL_SOURCE } } },
    });
    let sourceId = sources[0]?.id;
    const txs = [];
    if (!sourceId) {
      sourceId = id();
      txs.push(
        adminDb.tx.sources[sourceId].create({
          description: MANUAL_SOURCE,
          createdAt: Date.now(),
        }),
      );
    }

    const personId = id();
    txs.push(
      adminDb.tx.people[personId]
        .create({
          name,
          slug,
          status: 'none',
          context: context || undefined,
          createdAt: Date.now(),
        })
        .link({ sources: sourceId }),
    );
    await adminDb.transact(txs);

    return NextResponse.json({ ok: true, id: personId, slug });
  } catch (err) {
    console.error('create person error', err);
    return NextResponse.json({ error: 'Create failed' }, { status: 500 });
  }
}
