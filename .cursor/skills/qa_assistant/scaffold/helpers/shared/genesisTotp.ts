/**
 * Compute the current 6-digit TOTP code for a genesis customer's
 * 2-factor-auth secret.
 *
 * Reads the customer's row from the genesis MySQL `ota.customer_2fa`
 * table (joined to `ota.customers` on `customer_id`, scoped by brand
 * via `customers.site_id`), then computes the time-based one-time
 * password using the OTPHP-compatible parameters genesis enforces in
 * `Momentum_Account_App_Account_Helper::createTOTPInstance()`:
 *
 *   - secret: base32-encoded ASCII (genesis stores `Base32::encode(uniqid())`)
 *   - period: 600 seconds (10-minute window — NOT the RFC default 30s)
 *   - algorithm: SHA1
 *   - digits: 6
 *
 * The genesis verifier accepts any code generated within roughly the
 * last ~20 minutes (period 600 + leeway PERIOD-1). On a successful
 * `login-process` call genesis ROTATES the secret via
 * `Mv_Ota_Customer_2FA::reset()`, so each call to {@link totpForCustomer}
 * re-reads the secret from the DB rather than caching it in process
 * state.
 *
 * This function makes a fresh MySQL connection per call and closes it
 * before returning. Tests should not invoke it inside hot loops.
 */

import { createConnection } from 'mysql2/promise';
import { TOTP, Secret } from 'otpauth';

/** Genesis enforces a 10-minute period in `Momentum_Account_App_Account_Helper::TOTP_PERIOD`. */
const GENESIS_TOTP_PERIOD_SECONDS = 600;
const GENESIS_TOTP_DIGITS = 6;

export type Brand = 'flighthub' | 'justfly';

/**
 * Genesis brand → `ota.sites.id` mapping. Verified live against
 * `SELECT id, name FROM ota.sites` on staging2: `flighthub.com` → 1,
 * `justfly.com` → 4. Both brands share one MySQL `customers` table;
 * `site_id` is the only column that disambiguates per-brand customer
 * rows that share an email.
 */
function brandSiteId(brand: Brand): number {
    switch (brand) {
        case 'flighthub':
            return 1;
        case 'justfly':
            return 4;
        default: {
            const exhaustive: never = brand;
            throw new Error(`Unknown brand: ${String(exhaustive)}`);
        }
    }
}

/**
 * Read the current customer 2FA secret from the genesis MySQL DB and
 * compute the live 6-digit TOTP code valid against `login-process`.
 *
 * @param email Customer email — joined against `ota.customers.email`.
 * @param brand Brand the customer belongs to (`'flighthub'` or
 *   `'justfly'`); maps to `ota.customers.site_id` (1 / 4) so the right
 *   per-brand customer row is picked when the same email exists on
 *   both brands. Defaults to `process.env.BRAND` (the env var the
 *   Playwright project sets at run start).
 * @returns The current 6-digit TOTP code as a zero-padded string.
 * @throws If the customer is not found, has no `customer_2fa` row, or
 *   the brand → site_id mapping is unknown.
 */
export async function totpForCustomer(
    email: string,
    brand: Brand = (process.env.BRAND as Brand | undefined) ?? 'flighthub'
): Promise<string> {
    const siteId = brandSiteId(brand);
    const conn = await createConnection({
        host: process.env.MYSQL_HOST!,
        port: Number(process.env.MYSQL_PORT ?? 3306),
        user: process.env.MYSQL_USER!,
        password: process.env.MYSQL_PASSWORD!,
        database: process.env.MYSQL_DATABASE ?? 'ota',
    });

    try {
        // Filter on `c.active = 1` and pick the most recent customer
        // row: when a customer self-deactivates via the `account/delete-
        // account` flow the row is kept (`active=0`) and a fresh row may
        // be re-signed-up under the same email later. Without the active
        // filter LIMIT 1 returns the original deactivated row, whose
        // 2FA secret no longer matches the live one and triggers the
        // 3000025 invalid-TOTP failure envelope. ORDER BY id DESC also
        // guards against any future case where two active rows coexist
        // (`customers.email` is non-unique — `MUL` index, not unique).
        const [rows] = await conn.execute(
            `SELECT f.secret AS secret
             FROM customer_2fa f
             JOIN customers c ON c.id = f.customer_id
             WHERE c.email = ? AND c.site_id = ? AND c.active = 1
             ORDER BY c.id DESC
             LIMIT 1`,
            [email, siteId]
        );

        const secret = (rows as Array<{ secret: string }>)[0]?.secret;
        if (!secret) {
            throw new Error(
                `genesisTotp: no customer_2fa row for email='${email}' site_id=${siteId} (brand=${brand}). ` +
                    `Verify the customer was created on this brand and is active.`
            );
        }

        const totp = new TOTP({
            secret: Secret.fromBase32(secret.toUpperCase()),
            algorithm: 'SHA1',
            digits: GENESIS_TOTP_DIGITS,
            period: GENESIS_TOTP_PERIOD_SECONDS,
        });

        return totp.generate();
    } finally {
        await conn.end();
    }
}
