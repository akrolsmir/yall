import { NextRequest, NextResponse } from 'next/server';
import { id } from '@instantdb/admin';
import { adminDb } from '@/lib/adminDb';

// Admin approves or rejects a claim request (for people with no email on
// file). Linking $users requires the admin SDK, hence a server route.
export async function POST(req: NextRequest) {
  try {
    const { refreshToken, claimId, action } = await req.json();
    if (!refreshToken || !claimId || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const caller = await adminDb.auth.verifyToken(refreshToken);
    if (!caller) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    const { $users } = await adminDb.query({
      $users: { $: { where: { id: caller.id } } },
    });
    if ($users[0]?.isAdmin !== true) {
      return NextResponse.json({ error: 'Not an admin' }, { status: 403 });
    }

    const { claims } = await adminDb.query({
      claims: {
        $: { where: { id: claimId } },
        person: { claimedBy: {}, profile: {} },
        user: {},
      },
    });
    const claim = claims[0];
    if (!claim || !claim.person || !claim.user) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    if (action === 'reject') {
      await adminDb.transact(
        adminDb.tx.claims[claim.id].update({ status: 'rejected' }),
      );
      return NextResponse.json({ ok: true });
    }

    if (claim.person.claimedBy) {
      return NextResponse.json(
        { error: 'Profile already claimed' },
        { status: 409 },
      );
    }

    await adminDb.transact([
      adminDb.tx.people[claim.person.id]
        .update({ updatedAt: Date.now() })
        .link({ claimedBy: claim.user.id }),
      adminDb.tx.claims[claim.id].update({ status: 'approved' }),
      ...(claim.person.profile
        ? []
        : [
            adminDb.tx.profiles[id()]
              .update({})
              .link({ person: claim.person.id }),
          ]),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('claim review error', err);
    return NextResponse.json({ error: 'Review failed' }, { status: 500 });
  }
}
