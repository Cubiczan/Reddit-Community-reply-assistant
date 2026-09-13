import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  ThreadListQuerySchema,
  searchParamsObject,
  threadListWhere,
} from '@/lib/query-guards';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = ThreadListQuerySchema.safeParse(
      searchParamsObject(searchParams, ['businessId', 'status', 'minScore']),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const threads = await db.redditThread.findMany({
      where: threadListWhere(parsed.data),
      orderBy: { totalScore: 'desc' },
      take: 100,
    });
    return NextResponse.json(threads);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
