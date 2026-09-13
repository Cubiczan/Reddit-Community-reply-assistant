import { z } from 'zod';

/**
 * Guards user-controlled values before they enter Prisma `where` clauses.
 *
 * Prisma (and NoSQL engines) treat object values as operators
 * (`{ $ne: null }`, `{ not: "x" }`, `{ in: [...] }`). Passing a request
 * JSON field or unsanitized query object straight into `where` is the
 * classic NoSQL / ORM-operator injection. These schemas force scalar
 * strings / numbers and an allowlisted status enum so operators cannot
 * be smuggled in.
 */

/** Prisma `@default(cuid())` ids plus a conservative extra charset. */
export const EntityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const REPLY_STATUSES = ['pending', 'approved', 'posted', 'skipped'] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

export const ReplyStatusSchema = z.enum(REPLY_STATUSES);

export const BusinessIdBodySchema = z
  .object({
    businessId: EntityIdSchema,
  })
  .strict();

export const ThreadListQuerySchema = z.object({
  businessId: EntityIdSchema.optional(),
  status: ReplyStatusSchema.optional(),
  minScore: z.coerce.number().int().finite().optional(),
});

export const BusinessFilterQuerySchema = z.object({
  businessId: EntityIdSchema.optional(),
});

export type ThreadListWhere = {
  businessId?: string;
  replyStatus?: ReplyStatus;
  totalScore?: { gte: number };
};

export type BusinessFilterWhere = {
  businessId?: string;
};

export function parseEntityId(
  value: unknown,
): { ok: true; id: string } | { ok: false } {
  const parsed = EntityIdSchema.safeParse(value);
  if (!parsed.success) return { ok: false };
  return { ok: true, id: parsed.data };
}

/**
 * Build a Prisma `where` from already-validated list-query fields.
 * Values are copied as scalars — never spread raw user objects.
 */
export function threadListWhere(
  query: z.infer<typeof ThreadListQuerySchema>,
): ThreadListWhere {
  const where: ThreadListWhere = {};
  if (query.businessId) where.businessId = query.businessId;
  if (query.status) where.replyStatus = query.status;
  if (query.minScore !== undefined) where.totalScore = { gte: query.minScore };
  return where;
}

export function businessFilterWhere(
  query: z.infer<typeof BusinessFilterQuerySchema>,
): BusinessFilterWhere {
  if (!query.businessId) return {};
  return { businessId: query.businessId };
}

export function searchParamsObject(
  searchParams: URLSearchParams,
  keys: readonly string[],
): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value !== null) raw[key] = value;
  }
  return raw;
}
