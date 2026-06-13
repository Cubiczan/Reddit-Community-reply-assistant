import snoowrap from 'snoowrap';
import { retry } from './resilience/retry';
import { ResilienceError } from './resilience/errors';

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

  const client = new snoowrap({
    userAgent: 'RedditMarketingSystem/1.0 by ' + username,
    clientId,
    clientSecret,
    username,
    password,
  });

  // Bound every Reddit API request so a slow/unresponsive Reddit cannot hang
  // a scan run indefinitely. snoowrap aborts the underlying request after this.
  client.config({ requestTimeout: 10_000 });

  return client;
}

const RETRYABLE_REDDIT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Decide whether a Reddit/snoowrap error is transient and worth retrying.
 * Retries on rate limits (429) and 5xx; also retries network/timeout errors
 * that carry no HTTP status. Fails fast on other 4xx (e.g. 400/403/404).
 */
function isRetryableRedditError(error: unknown): boolean {
  if (error instanceof ResilienceError) {
    if (error.kind === 'aborted' || error.kind === 'ssrf') return false;
    return error.status === undefined || RETRYABLE_REDDIT_STATUS.has(error.status);
  }
  const status = (error as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (error as { status?: number } | null)?.status;
  if (typeof status === 'number') return RETRYABLE_REDDIT_STATUS.has(status);
  // No status (network/timeout/abort surfaced by snoowrap) — treat as transient.
  return true;
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
      // Retry the search with exponential backoff + jitter so a transient
      // 429/5xx from Reddit does not silently drop this keyword's results.
      const posts = await retry(
        () =>
          client
            .getSubreddit(subredditNames)
            .search({
              query: keyword,
              sort: params.sort || 'new',
              time: params.timeRange || 'week',
              // `limit` is supported at runtime (listing option) but missing from
              // snoowrap's BaseSearchOptions typings.
              limit: params.limit || 25,
            } as Parameters<ReturnType<typeof client.getSubreddit>['search']>[0]),
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          shouldRetry: (error) => isRetryableRedditError(error),
        }
      );

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
