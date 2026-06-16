/**
 * Translates a subscription's `{ subject, recursive, eventTypes }` options into
 * SQL predicates over the `events` table's `subject` and `event_type` columns.
 *
 * The `subject` column holds the CloudEvents subject, which in this store is the
 * `streamId` (e.g. `"Order-123"`). Filtering therefore works like a stream
 * prefix/exact match:
 *
 * - `subject` only: exact match (`subject = $n`).
 * - `subject` + `recursive`: prefix match including children
 *   (`subject = $n OR subject LIKE $n || '%'`), so `"/orders"` also matches
 *   `"/orders/123"` and `"Order-"` matches `"Order-123"`.
 * - `eventTypes`: restrict to the given CloudEvents types (`event_type = ANY($n)`).
 *
 * Predicates are parameterized; callers provide the starting placeholder index
 * so the fragment can be spliced into a larger query.
 */
export interface SubjectFilter {
  subject?: string;
  recursive?: boolean;
  eventTypes?: string[];
}

export interface BuiltFilter {
  /** SQL fragment combined with `AND`, or empty string when no filter applies. */
  clause: string;
  /** Positional parameters matching the placeholders in {@link clause}. */
  params: (string | string[])[];
}

/**
 * Builds the SQL predicate fragment for a subject/event-type filter.
 *
 * @param filter - the subscription filter options.
 * @param startIndex - the first `$n` placeholder index to use (1-based).
 */
export function buildSubjectFilter(
  filter: SubjectFilter,
  startIndex: number,
): BuiltFilter {
  const clauses: string[] = [];
  const params: (string | string[])[] = [];
  let idx = startIndex;

  if (filter.subject !== undefined) {
    if (filter.recursive) {
      const exact = `$${idx}`;
      params.push(filter.subject);
      idx += 1;
      const prefix = `$${idx}`;
      params.push(`${filter.subject}%`);
      idx += 1;
      clauses.push(`(subject = ${exact} OR subject LIKE ${prefix})`);
    } else {
      clauses.push(`subject = $${idx}`);
      params.push(filter.subject);
      idx += 1;
    }
  }

  if (filter.eventTypes !== undefined && filter.eventTypes.length > 0) {
    clauses.push(`event_type = ANY($${idx})`);
    params.push(filter.eventTypes);
  }

  return { clause: clauses.join(" AND "), params };
}
