import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { LLMConfigError, toSseResponseStream } from '@/lib/llm';
import { getLibraryProvider } from '@/lib/library/llm';
import { buildChatContext } from '@/lib/library/retrieval';
import { canReadDoc, libraryViewerFromSession } from '@/lib/library-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(24),
});

// POST /api/library/docs/[id]/chat (login, SSE) — grounded "ask this document"
// chat over the cached AI index (two-stage retrieval, no per-user AI cost beyond
// the answer itself).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:chat:${session.user.id}`, 60, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const messages = parsed.data.messages;
  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    return NextResponse.json(
      { error: 'invalid_input', reason: '最后一条消息必须来自用户' },
      { status: 400 },
    );
  }

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, deletedAt: true, uploaderId: true, visibility: true },
  });
  if (!doc || doc.deletedAt || doc.status !== 'ready') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!(await canReadDoc(doc, libraryViewerFromSession(session)))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let provider;
  try {
    provider = (await getLibraryProvider()).provider;
  } catch (e) {
    if (e instanceof LLMConfigError) {
      return NextResponse.json({ error: 'llm_unconfigured', reason: e.message }, { status: 503 });
    }
    throw e;
  }

  const context = await buildChatContext(doc.id, last.content, messages.slice(0, -1));
  if (!context.ok) {
    if (context.error === 'not_indexed') {
      return NextResponse.json({ error: 'not_indexed' }, { status: 409 });
    }
    if (context.error === 'no_content') {
      return NextResponse.json({ error: 'no_content' }, { status: 409 });
    }
    return NextResponse.json({ error: 'llm_error' }, { status: 502 });
  }

  // ReaderChatPanel maps the [cX-Y] citation markers in the answer back to
  // excerpt positions for in-reader jumps. Sent as the FIRST SSE frame, not a
  // response header — ~20 excerpts of CJK snippets exceed nginx's default
  // proxy_buffer_size and would 502 the intranet deploy.
  const citations = context.excerpts.map((e) => ({
    key: e.key,
    chapterIndex: e.chapterIndex,
    charStart: e.charStart,
    snippet: e.text.slice(0, 80),
  }));

  // Persist the exchange once the stream finishes (finally also fires on
  // client abort, so a partially received answer is still kept).
  const userId = session.user.id;
  const question = last.content;
  async function* teeAndPersist(source: AsyncIterable<string>): AsyncIterable<string> {
    let full = '';
    try {
      for await (const delta of source) {
        full += delta;
        yield delta;
      }
    } finally {
      if (full.trim()) {
        prisma
          .$transaction([
            prisma.libraryChatMessage.create({
              data: { docId: params.id, userId, role: 'user', content: question },
            }),
            prisma.libraryChatMessage.create({
              data: { docId: params.id, userId, role: 'assistant', content: full, citations },
            }),
          ])
          .catch((e) => console.error('[library] chat persist failed', e));
      }
    }
  }

  const deltas = teeAndPersist(
    provider.streamDeltas({
      system: context.system,
      messages: messages.slice(-12),
    }),
  );

  const encoder = new TextEncoder();
  const upstream = toSseResponseStream(deltas).getReader();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ citations })}\n\n`));
    },
    async pull(controller) {
      const { done, value } = await upstream.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return upstream.cancel(reason);
    },
  });

  return new NextResponse(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-ratelimit-remaining': String(gate.remaining),
    },
  });
}
