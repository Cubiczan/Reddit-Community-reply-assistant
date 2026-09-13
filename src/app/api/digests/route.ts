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

    const digests = await db.emailDigest.findMany({
      where: businessFilterWhere(parsed.data),
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
    return NextResponse.json(digests);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
