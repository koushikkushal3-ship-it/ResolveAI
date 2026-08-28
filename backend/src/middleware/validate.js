/**
 * Zod validation middleware.
 *
 * Every body, param and query value that can affect behaviour goes through
 * here. The parsed result REPLACES the raw input, so downstream code sees
 * coerced, stripped, known-shaped data and can never accidentally read an
 * unvalidated field an attacker supplied.
 *
 * Express 5 makes req.query a getter, so it is redefined rather than assigned.
 *
 * @param {{ body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny }} schemas
 */
export function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.params) req.params = schemas.params.parse(req.params ?? {});
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query ?? {});
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
        });
      }
      next();
    } catch (err) {
      next(err); // ZodError is shaped into a 400 by the error handler.
    }
  };
}
