import snoowrap from 'snoowrap';

export interface RedditSearchParams {
  query: string;
  subreddits: string[];
  sort?: 'relevance' | 'hot' | 'new' | 'top';
  timeRange?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  limit?: number;
}

export interface RedditPost {
  id: string;
  title: string;
  author: string;
  selftext: string;
  url: string;
  score: number;
  num_comments: number;
  subreddit: string;
  created_utc: number;
  permalink: string;
}

export function isRedditConfigured(): boolean {
  return !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET && process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD);
}

export async function createRedditClient(): Promise<snoowrap> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error('Reddit API credentials not configured in .env');
  }

  return new snoowrap({
    userAgent: 'RedditMarketingSystem/1.0 by ' + username,
    clientId,
    clientSecret,
    username,
    password,
  });
}

export async function searchReddit(
  client: snoowrap,
  params: RedditSearchParams
): Promise<RedditPost[]> {
  const subredditNames = params.subreddits.join('+');
  const results: RedditPost[] = [];
  const keywords = params.query.split(',').map(k => k.trim()).filter(Boolean);

  for (const keyword of keywords.slice(0, 5)) {
    try {
      const posts = await client
        .getSubreddit(subredditNames)
        .search({
          query: keyword,
          sort: params.sort || 'new',
          time: params.timeRange || 'week',
          // `limit` is supported at runtime (listing option) but missing from
          // snoowrap's BaseSearchOptions typings.
          limit: params.limit || 25,
        } as Parameters<ReturnType<typeof client.getSubreddit>['search']>[0]);

      for (const post of posts) {
        if (!results.find(p => p.id === post.id)) {
          results.push({
            id: post.id,
            title: post.title,
            author: (post as any).author?.name || '[deleted]',
            selftext: post.selftext || '',
            url: `https://reddit.com${post.permalink}`,
            score: post.score || 0,
            num_comments: post.num_comments || 0,
            subreddit: (post as any).subreddit?.display_name || '',
            created_utc: post.created_utc,
            permalink: post.permalink,
          });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1200));
    } catch (error) {
      console.error(`Error searching for "${keyword}":`, error);
    }
  }

  return results;
}

export async function testRedditConnection(): Promise<boolean> {
  try {
    const client = await createRedditClient();
    // Cast: snoowrap's RedditUser type is its own promise fulfillment value,
    // which trips TS1062 when awaited directly.
    await (client.getMe() as unknown as Promise<unknown>);
    return true;
  } catch {
    return false;
  }
}
