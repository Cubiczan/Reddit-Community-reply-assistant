import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendDigestEmail } from '@/lib/email-service';
import { BusinessIdBodySchema } from '@/lib/query-guards';

export async function POST(request: Request) {
  try {
    const parsed = BusinessIdBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { businessId } = parsed.data;
    const business = await db.businessProfile.findUnique({ where: { id: businessId } });
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    const threads = await db.redditThread.findMany({
      where: { businessId, isRelevant: true, replyStatus: 'pending' },
      orderBy: { totalScore: 'desc' },
      take: 20,
    });

    if (threads.length === 0) {
      return NextResponse.json({ message: 'No new threads to digest' });
    }

    const digestThreads = threads.map(t => ({
      title: t.title,
      subreddit: t.subreddit,
      url: t.url,
      score: t.totalScore,
      buyingIntent: t.buyingIntentScore,
      draftReply: t.draftReply,
      matchedKeywords: JSON.parse(t.matchedKeywords || '[]'),
      matchedCompetitors: JSON.parse(t.matchedCompetitors || '[]'),
      intentSignals: JSON.parse(t.intentSignals || '[]'),
    }));

    const sent = await sendDigestEmail(business.email, business.name, digestThreads, (msg: string) => {
      console.log(msg);
    });

    if (sent) {
      await db.emailDigest.create({
        data: {
          businessId,
          threadCount: threads.length,
          subject: `Reddit Opportunities for ${business.name}`,
          topThreads: JSON.stringify(threads.slice(0, 10).map(t => t.id)),
          status: 'sent',
        },
      });
    }

    return NextResponse.json({ success: sent, threadCount: threads.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
