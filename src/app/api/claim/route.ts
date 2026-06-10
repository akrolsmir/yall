import { NextRequest, NextResponse } from 'next/server';
import { id } from '@instantdb/admin';
import { adminDb } from '@/lib/adminDb';

// Self-serve claim: signed-in user whose email matches the person's email on
// file claims the profile instantly. Linking $users is locked down by perms,
// so the link is made here with the admin SDK after verifying the token.
export async function POST(req: NextRequest) {
  try {
    const { refreshToken, personId } = await req.json();
    if (!refreshToken || !personId) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const user = await adminDb.auth.verifyToken(refreshToken);
    if (!user?.email) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const { people } = await adminDb.query({
      people: {
        $: { where: { id: personId } },
        claimedBy: {},
        profile: {},
      },
    });
    const person = people[0];
    if (!person) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    }
    if (person.claimedBy) {
      return NextResponse.json(
        { error: 'This profile is already claimed' },
        { status: 409 },
      );
    }
    if (
      !person.email ||
      person.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
    ) {
      return NextResponse.json(
        { error: 'Your email does not match this profile' },
        { status: 403 },
      );
    }

    // Also ensure a profile entity exists so the claimer can edit long-form
    // content (profile creation is admin-only by perms).
    await adminDb.transact([
      adminDb.tx.people[person.id]
        .update({ updatedAt: Date.now() })
        .link({ claimedBy: user.id }),
      ...(person.profile
        ? []
        : [adminDb.tx.profiles[id()].update({}).link({ person: person.id })]),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('claim error', err);
    return NextResponse.json({ error: 'Claim failed' }, { status: 500 });
  }
}
