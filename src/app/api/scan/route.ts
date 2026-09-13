import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createRedditClient, searchReddit } from '@/lib/reddit';
import { scoreThread, filterAndSort } from '@/lib/scorer';
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

    const scanRun = await db.scanRun.create({
      data: { businessId, status: 'running' },
    });

    try {
      const client = await createRedditClient();

      const subreddits: string[] = JSON.parse(business.subreddits || '[]');
      const keywords: string[] = JSON.parse(business.keywords || '[]');
      const competitors: string[] = JSON.parse(business.competitors || '[]');

      if (subreddits.length === 0 || keywords.length === 0) {
        await db.scanRun.update({
          where: { id: scanRun.id },
          data: { status: 'failed', errorMessage: 'No subreddits or keywords configured', completedAt: new Date() },
        });
        return NextResponse.json({ error: 'No subreddits or keywords configured' }, { status: 400 });
      }

      const posts = await searchReddit(client, {
        query: keywords.join(','),
        subreddits,
        sort: 'new',
        timeRange: 'week',
        limit: 50,
      });

      const scoredThreads = posts.map(post =>
        scoreThread(post, {
          keywords,
          competitors,
          weightComments: business.scoreWeightComments,
          weightUpvotes: business.scoreWeightUpvotes,
          weightRecency: business.scoreWeightRecency,
          weightKeywords: business.scoreWeightKeywords,
        })
      );

      const topThreads = filterAndSort(scoredThreads, 20);

      for (const thread of topThreads) {
        const existing = await db.redditThread.findFirst({
          where: { businessId, redditId: thread.post.id },
        });
        if (existing) continue;

        await db.redditThread.create({
          data: {
            businessId,
            redditId: thread.post.id,
            subreddit: thread.post.subreddit,
            title: thread.post.title,
            author: thread.post.author,
            selftext: thread.post.selftext.substring(0, 5000),
            url: thread.post.url,
            score: thread.post.score,
            numComments: thread.post.num_comments,
            createdAtReddit: new Date(thread.post.created_utc * 1000),
            engagementScore: thread.engagementScore,
            buyingIntentScore: thread.buyingIntentScore,
            totalScore: thread.totalScore,
            matchedKeywords: JSON.stringify(thread.matchedKeywords),
            matchedCompetitors: JSON.stringify(thread.matchedCompetitors),
            intentSignals: JSON.stringify(thread.intentSignals),
            isRelevant: thread.totalScore >= 30,
            isProcessed: false,
            scanRunId: scanRun.id,
          },
        });
      }

      await db.scanRun.update({
        where: { id: scanRun.id },
        data: {
          status: 'completed',
          threadsFound: posts.length,
          threadsScored: topThreads.length,
          completedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        scanRunId: scanRun.id,
        threadsFound: posts.length,
        threadsScored: topThreads.length,
      });
    } catch (error: any) {
      await db.scanRun.update({
        where: { id: scanRun.id },
        data: { status: 'failed', errorMessage: error.message, completedAt: new Date() },
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
