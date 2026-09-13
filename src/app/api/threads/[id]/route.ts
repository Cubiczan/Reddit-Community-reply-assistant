import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { draftReply } from '@/lib/reply-drafter';
import type { ScoredThread } from '@/lib/scorer';
import { parseEntityId, ReplyStatusSchema } from '@/lib/query-guards';

/**
 * Explicit allowlist of user-mutable thread fields. Prevents mass-assignment:
 * the raw request body was previously spread straight into `data`, letting a
 * caller overwrite scores, ids, redditId, businessId, timestamps, etc.
 * Only these review-workflow fields may be updated via PUT.
 */
const ThreadUpdateSchema = z
  .object({
    replyStatus: ReplyStatusSchema,
    isRelevant: z.boolean(),
    isProcessed: z.boolean(),
    notes: z.string().nullable(),
    draftReply: z.string().nullable(),
  })
  .partial()
  .strict();

function routeId(id: string) {
  return parseEntityId(id);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const idParsed = routeId(rawId);
    if (!idParsed.ok) {
      return NextResponse.json({ error: 'Invalid thread id' }, { status: 400 });
    }
    const { id } = idParsed;
    const body = await request.json();
    const parsed = ThreadUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid update payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const thread = await db.redditThread.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json(thread);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const idParsed = routeId(rawId);
    if (!idParsed.ok) {
      return NextResponse.json({ error: 'Invalid thread id' }, { status: 400 });
    }
    const { id } = idParsed;
    const thread = await db.redditThread.findUnique({
      where: { id },
      include: { business: true },
    });
    if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

    const scoredThread: ScoredThread = {
      post: {
        id: thread.redditId,
        title: thread.title,
        author: thread.author,
        selftext: thread.selftext,
        url: thread.url,
        score: thread.score,
        num_comments: thread.numComments,
        subreddit: thread.subreddit,
        created_utc: Math.floor(thread.createdAtReddit.getTime() / 1000),
        permalink: '',
      },
      engagementScore: thread.engagementScore,
      buyingIntentScore: thread.buyingIntentScore,
      totalScore: thread.totalScore,
      matchedKeywords: JSON.parse(thread.matchedKeywords || '[]'),
      matchedCompetitors: JSON.parse(thread.matchedCompetitors || '[]'),
      intentSignals: JSON.parse(thread.intentSignals || '[]'),
    };

    const reply = await draftReply(scoredThread, {
      name: thread.business.name,
      description: thread.business.description,
      valueProposition: thread.business.valueProposition,
      replyTone: thread.business.replyTone,
      website: thread.business.website,
    });

    await db.redditThread.update({
      where: { id },
      data: { draftReply: reply, isProcessed: true },
    });

    return NextResponse.json({ draftReply: reply });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
