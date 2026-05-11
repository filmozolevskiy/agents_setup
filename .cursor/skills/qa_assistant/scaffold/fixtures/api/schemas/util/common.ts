import { z } from 'zod/v4';
import type { ZodType, ZodObject, ZodArray, core as zCore } from 'zod/v4';

/**
 * Standard API response envelope helper.
 *
 * Wraps a per-endpoint `dataSchema` and `errorsSchema` with the canonical
 * `{ success, message, data, errors }` envelope so individual endpoint
 * schemas only describe the payload, never the wrapper.
 *
 * Pass `z.unknown().nullable()` for `errorsSchema` when an endpoint does not
 * have a structured error array; the helper itself stays agnostic to the
 * error item shape.
 *
 * @param dataSchema - Zod schema for the endpoint-specific `data` payload.
 * @param errorsSchema - Zod schema for the items in the `errors` array (use
 *   `z.unknown().nullable()` when the shape is endpoint-specific or unknown).
 * @returns A `z.strictObject({...})` schema for the full response envelope.
 *
 * @example
 * const ProductResponseSchema = createApiResponseSchema(
 *     ProductSchema,
 *     z.unknown().nullable()
 * );
 * expect(ProductResponseSchema.parse(body)).toBeTruthy();
 */
export function createApiResponseSchema<
    DataSchema extends ZodType,
    ErrorsSchema extends ZodType,
>(
    dataSchema: DataSchema,
    errorsSchema: ErrorsSchema
): ZodObject<
    {
        success: z.ZodBoolean;
        message: z.ZodString;
        data: DataSchema;
        errors: ZodArray<ErrorsSchema>;
    },
    zCore.$strict
> {
    return z.strictObject({
        success: z.boolean(),
        message: z.string(),
        data: dataSchema,
        errors: z.array(errorsSchema),
    });
}
