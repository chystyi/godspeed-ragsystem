/** A per-user cap was reached (for example the number of documents). Answered with 409. */
export class LimitReachedError extends Error {
  constructor(readonly resource: string, readonly limit: number) {
    super(`you have reached the limit of ${limit} ${resource}; delete one first`);
    this.name = 'LimitReachedError';
  }
}

/** Postgres error code the database raises (see the `enforce_row_limit` trigger). */
export const ROW_LIMIT_SQLSTATE = 'P0004';
