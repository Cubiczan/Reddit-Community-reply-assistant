import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseEntityId } from '@/lib/query-guards';

function routeId(id: string) {
  return parseEntityId(id);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const idParsed = routeId(rawId);
    if (!idParsed.ok) {
      return NextResponse.json({ error: 'Invalid business id' }, { status: 400 });
    }
    const { id } = idParsed;
    const business = await db.businessProfile.findUnique({
      where: { id },
      include: {
        _count: {
          select: { threads: true, scanRuns: true },
        },
      },
    });
    if (!business) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(business);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const idParsed = routeId(rawId);
    if (!idParsed.ok) {
      return NextResponse.json({ error: 'Invalid business id' }, { status: 400 });
    }
    const { id } = idParsed;
    const body = await request.json();
    const business = await db.businessProfile.update({
      where: { id },
      data: body,
    });
    return NextResponse.json(business);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const idParsed = routeId(rawId);
    if (!idParsed.ok) {
      return NextResponse.json({ error: 'Invalid business id' }, { status: 400 });
    }
    const { id } = idParsed;
    await db.redditThread.deleteMany({ where: { businessId: id } });
    await db.scanRun.deleteMany({ where: { businessId: id } });
    await db.emailDigest.deleteMany({ where: { businessId: id } });
    await db.businessProfile.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
