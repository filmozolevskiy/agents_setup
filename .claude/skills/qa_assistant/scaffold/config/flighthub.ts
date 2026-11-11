/**
 * Flighthub brand configuration.
 * Reads brand-prefixed env vars from `env/.env.flighthub.{environment}`.
 *
 * For route paths and API endpoints, use enums from `enums/flighthub/flighthub.ts`
 * (or shared genesis endpoints from `enums/shared/genesis.ts`).
 */
export const flighthubConfig = {
    /** Frontend application URL */
    appUrl: process.env.FLIGHTHUB_APP_URL,
    /** Backend (genesis) API URL */
    apiUrl: process.env.FLIGHTHUB_API_URL,
};
