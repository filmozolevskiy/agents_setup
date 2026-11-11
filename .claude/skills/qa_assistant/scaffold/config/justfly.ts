/**
 * JustFly brand configuration.
 * Reads brand-prefixed env vars from `env/.env.justfly.{environment}`.
 *
 * For route paths and API endpoints, use enums from `enums/justfly/justfly.ts`
 * (or shared genesis endpoints from `enums/shared/genesis.ts`).
 */
export const justflyConfig = {
    /** Frontend application URL */
    appUrl: process.env.JUSTFLY_APP_URL,
    /** Backend (genesis) API URL */
    apiUrl: process.env.JUSTFLY_API_URL,
};
