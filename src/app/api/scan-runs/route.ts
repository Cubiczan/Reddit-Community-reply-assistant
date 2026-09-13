import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  BusinessFilterQuerySchema,
  businessFilterWhere,
  searchParamsObject,
} from '@/lib/query-guards';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = BusinessFilterQuerySchema.safeParse(
      searchParamsObject(searchParams, ['businessId']),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const scanRuns = await db.scanRun.findMany({
      where: businessFilterWhere(parsed.data),
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return NextResponse.json(scanRuns);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
