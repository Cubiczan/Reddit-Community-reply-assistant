import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BusinessIdBodySchema,
  BusinessFilterQuerySchema,
  EntityIdSchema,
  ReplyStatusSchema,
  ThreadListQuerySchema,
  businessFilterWhere,
  parseEntityId,
  searchParamsObject,
  threadListWhere,
} from '../src/lib/query-guards.ts';

describe('EntityIdSchema', () => {
  it('accepts Prisma cuid-style ids', () => {
    assert.equal(EntityIdSchema.parse('clxyz0123456789abcdefgh'), 'clxyz0123456789abcdefgh');
  });

  it('rejects NoSQL / Prisma operator objects', () => {
    for (const payload of [
      { $ne: null },
      { $gt: '' },
      { $regex: '.*' },
      { not: 'impossible' },
      { in: ['a'] },
      { equals: 'x' },
    ]) {
      const result = EntityIdSchema.safeParse(payload);
      assert.equal(result.success, false, `expected reject ${JSON.stringify(payload)}`);
    }
  });

  it('rejects empty, oversized, and punctuation-bearing ids', () => {
    assert.equal(EntityIdSchema.safeParse('').success, false);
    assert.equal(EntityIdSchema.safeParse('a'.repeat(65)).success, false);
    assert.equal(EntityIdSchema.safeParse('id;drop').success, false);
    assert.equal(EntityIdSchema.safeParse('id with space').success, false);
  });
});

describe('BusinessIdBodySchema', () => {
  it('accepts a scalar businessId', () => {
    assert.deepEqual(BusinessIdBodySchema.parse({ businessId: 'biz_1' }), {
      businessId: 'biz_1',
    });
  });

  it('rejects operator injection in JSON body', () => {
    const result = BusinessIdBodySchema.safeParse({
      businessId: { $ne: null },
    });
    assert.equal(result.success, false);
  });

  it('rejects extra keys (mass-assignment / query smuggling)', () => {
    const result = BusinessIdBodySchema.safeParse({
      businessId: 'biz_1',
      $where: '1 == 1',
    });
    assert.equal(result.success, false);
  });
});

describe('ThreadListQuerySchema + threadListWhere', () => {
  it('builds parameterized equality and gte filters from scalars', () => {
    const parsed = ThreadListQuerySchema.parse({
      businessId: 'biz_1',
      status: 'pending',
      minScore: '40',
    });
    assert.deepEqual(threadListWhere(parsed), {
      businessId: 'biz_1',
      replyStatus: 'pending',
      totalScore: { gte: 40 },
    });
  });

  it('does not copy unknown operator keys into the where clause', () => {
    const parsed = ThreadListQuerySchema.safeParse({
      businessId: 'biz_1',
      $or: [{ replyStatus: 'pending' }],
    });
    assert.equal(parsed.success, true);
    assert.deepEqual(threadListWhere(parsed.data), { businessId: 'biz_1' });
  });

  it('rejects status values outside the allowlist', () => {
    assert.equal(ThreadListQuerySchema.safeParse({ status: 'all' }).success, false);
    assert.equal(ThreadListQuerySchema.safeParse({ status: { $ne: 'pending' } }).success, false);
  });
});

describe('businessFilterWhere', () => {
  it('returns a scalar businessId filter or empty object', () => {
    assert.deepEqual(
      businessFilterWhere(BusinessFilterQuerySchema.parse({ businessId: 'biz_1' })),
      { businessId: 'biz_1' },
    );
    assert.deepEqual(businessFilterWhere(BusinessFilterQuerySchema.parse({})), {});
  });
});

describe('searchParamsObject', () => {
  it('copies only allowlisted keys as strings', () => {
    const params = new URLSearchParams('businessId=biz_1&status=pending&extra=1');
    assert.deepEqual(searchParamsObject(params, ['businessId', 'status']), {
      businessId: 'biz_1',
      status: 'pending',
    });
  });
});

describe('parseEntityId / ReplyStatusSchema', () => {
  it('parseEntityId rejects operator objects', () => {
    assert.deepEqual(parseEntityId({ $ne: null }), { ok: false });
    assert.deepEqual(parseEntityId('thread_1'), { ok: true, id: 'thread_1' });
  });

  it('allowlists reply statuses', () => {
    assert.equal(ReplyStatusSchema.parse('approved'), 'approved');
    assert.equal(ReplyStatusSchema.safeParse('deleted').success, false);
  });
});
