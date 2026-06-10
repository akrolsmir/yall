import { NextRequest, NextResponse } from 'next/server';
import {
  runProfileGeneration,
  AlreadyRunningError,
  GenerationMode,
} from '@/lib/profileAgent';

// Deep runs take a few minutes of research + writing
export const maxDuration = 300;

// Anyone can trigger a profile run; progress is public via the runs entity.
export async function POST(req: NextRequest) {
  try {
    const { personId, mode } = await req.json();
    if (!personId || !['fast', 'deep'].includes(mode)) {
      return NextResponse.json(
        { error: 'personId and mode (fast|deep) required' },
        { status: 400 },
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Server is missing ANTHROPIC_API_KEY' },
        { status: 500 },
      );
    }
    const { runId, found } = await runProfileGeneration({
      personId,
      mode: mode as GenerationMode,
    });
    return NextResponse.json({ ok: true, runId, found });
  } catch (err) {
    if (err instanceof AlreadyRunningError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('generate error', err);
    const message = err instanceof Error ? err.message : 'Generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
