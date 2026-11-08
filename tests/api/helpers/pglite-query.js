// Adapts a PGlite instance to the queryFn shape that scripts/migrate.mjs expects.
export function pgliteQuery(pg) {
  return async (text, params) => {
    if (params === undefined) {
      const results = await pg.exec(text)
      return { rows: results.at(-1)?.rows ?? [] }
    }
    return pg.query(text, params)
  }
}
