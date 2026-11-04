import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

/**
 * Schema for 400 Bad Request responses.
 */
export const BadRequestResponseSchema = z.strictObject({
    message: z.union([z.string(), z.array(z.string())]),
    error: z.literal('Bad Request'),
    statusCode: z.literal(400),
});

/**
 * Schema for 401 Unauthorized responses.
 */
export const UnauthorizedResponseSchema = z.strictObject({
    message: z.literal('Unauthorized'),
    statusCode: z.literal(401),
});

/**
 * Schema for 403 Forbidden responses.
 */
export const ForbiddenResponseSchema = z.strictObject({
    message: z.string(),
    error: z.literal('Forbidden'),
    statusCode: z.literal(403),
});

/**
 * Schema for 404 Not Found responses.
 */
export const NotFoundResponseSchema = z.strictObject({
    message: z.string(),
    error: z.literal('Not Found'),
    statusCode: z.literal(404),
});

/**
 * Schema for the genesis Storefront API's native 4xx error envelope.
 *
 * Shape captured live from `GET https://staging2.flighthub.com/storefront-api/<bad-path>`
 * (404): `{ "error": true, "error_message": "Invalid function requested" }`.
 * Differs from the NestJS-style schemas above (`{message, error, statusCode}`),
 * which are kept as the canonical envelope for non-genesis services that may
 * eventually be added under `tests/shared/api/`.
 */
export const GenesisErrorResponseSchema = z.strictObject({
    error: z.literal(true),
    error_message: z.string(),
});

// Type exports
export type BadRequestResponse = zOutput<typeof BadRequestResponseSchema>;
export type UnauthorizedResponse = zOutput<typeof UnauthorizedResponseSchema>;
export type ForbiddenResponse = zOutput<typeof ForbiddenResponseSchema>;
export type NotFoundResponse = zOutput<typeof NotFoundResponseSchema>;
export type GenesisErrorResponse = zOutput<typeof GenesisErrorResponseSchema>;
