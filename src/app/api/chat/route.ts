import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/adminDb';
import { runChatTurn, ChatBusyError, ChatMode } from '@/lib/chatAgent';

// Deep replies can spend minutes on directory reads + web research
export const maxDuration = 300;

// The client writes the chat + user message itself (perms-scoped), then calls
// this to stream an assistant reply into the chat via the admin SDK.
export async function POST(req: NextRequest) {
  try {
    const { refreshToken, chatId, mode } = await req.json();
    if (!refreshToken || !chatId || !['fast', 'deep'].includes(mode)) {
      return NextResponse.json(
        { error: 'refreshToken, chatId, and mode (fast|deep) required' },
        { status: 400 },
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Server is missing ANTHROPIC_API_KEY' },
        { status: 500 },
      );
    }

    const user = await adminDb.auth.verifyToken(refreshToken);
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const { messageId } = await runChatTurn({
      chatId,
      userId: user.id,
      mode: mode as ChatMode,
    });
    return NextResponse.json({ ok: true, messageId });
  } catch (err) {
    if (err instanceof ChatBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('chat error', err);
    const message = err instanceof Error ? err.message : 'Chat failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
