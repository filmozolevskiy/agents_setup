/**
 * Self-deactivate a genesis customer via the storefront UI cookie-session
 * flow — the only customer-deletion vector reachable from the scaffold's
 * read-only DB / read-only repo permissions.
 *
 * Why a UI-flavoured helper for an API-test cleanup?
 *
 *   1. There is **no Storefront API endpoint** that deletes or
 *      deactivates a customer (verified against the OpenAPI spec at
 *      `app_source_code/genesis/include/Mv/Ota/Jfly/App/StorefrontApi/openapi.yaml`
 *      and the live `actionLogout` is the only delete-flavoured action).
 *   2. The CMS hard-purge route
 *      (`Mv_Ota_Cms_App_CustomerInfo::actionPurge` →
 *      `Mv_Ota_Customer_DeletedData::purgeCustomerData`) lives on the
 *      internal `<staging>-reservations.voyagesalacarte.ca` host and
 *      requires an agent session with the `customer_delete_data`
 *      permission — out of scope under "read-only access to repo +
 *      DBs".
 *   3. `ota.customers` has no `deleted_at` column; only `active`
 *      (`tinyint(1)`) flips. We hold read-only DB access so direct SQL
 *      `UPDATE` is forbidden.
 *
 * The deprecated `Momentum\Account\App\Account::actionDeleteAccount`
 * (`@deprecated` in source — verified live on staging2 2026-05-06) is
 * the only working path. It sets `customers.active = 0` for the
 * authenticated `auth_user` and immediately calls `_authLogout()`.
 *
 * Critical genesis quirk that makes this an API-only cleanup despite
 * the "UI" flow: `Mv_Ota_Jfly_App_StorefrontApi::actionLoginProcess`
 * also calls `_authLogin($customerId)` on success — the **same JSON
 * `/storefront-api/login-process` POST that returns the JWT also sets
 * the legacy PHPSESSID cookie**. So a single APIRequestContext can:
 *
 *   1. Drive `login-init` → MySQL TOTP → `login-process` (cookie + JWT
 *      arrive on the response).
 *   2. GET `/account/delete-account` on the same context — the cookie
 *      is replayed automatically and `auth_user` is set, the
 *      `actionDeleteAccount` branch flips `active = 0`.
 *
 * This avoids spinning up a Chromium browser per teardown (would cost
 * ~3-5 s per `@destructive` test).
 *
 * Re-signup note: after deactivation the email is **immediately
 * available** for a fresh `customer-sign-up` because both
 * `actionCheckEmail` and `actionCustomerSignUp` filter on
 * `Mv_Ota_Customer::getActiveBySiteIdAndEmail` (i.e. they only see
 * `active = 1` rows). Per-test `+pwt-<uuid>@<brand>.com` aliases avoid
 * re-using the deactivated row at all and keep the audit trail clean.
 *
 * Hard-fail safety: if the post-condition MySQL check shows the row
 * still has `active = 1`, the helper throws. Better to fail noisily in
 * `afterEach` than to silently leak `active = 1` test customers into
 * staging.
 */

import { request as playwrightRequest } from '@playwright/test';
import { createConnection } from 'mysql2/promise';

import { ApiEndpoints } from '../../enums/shared/genesis';
import { flighthubConfig } from '../../config/flighthub';
import { justflyConfig } from '../../config/justfly';
import { genesisStorefrontAuthHeaders } from './genesisStorefrontAuthHeaders';
import { totpForCustomer, type Brand } from './genesisTotp';

/**
 * Maximum number of full login → delete-account attempts. Mirrors
 * {@link loginAsCustomer}'s rationale: the customer's `customer_2fa`
 * secret rotates on every successful `login-process`, so a parallel
 * test can win the secret race between our MySQL read and our POST.
 * Three attempts cover the common 2- and 3-test pile-up.
 */
const MAX_DEACTIVATE_ATTEMPTS = 3;

/** Genesis error_code returned for "TOTP wrong or expired" — the symptom of a secret-rotation race. */
const ERROR_CODE_TOTP_INVALID = 3000025;

/**
 * Genesis brand → `ota.sites.id` mapping. Duplicated from
 * `genesisTotp.ts` so this helper does not need to import an internal
 * (non-exported) function. Verified live: `flighthub.com` → 1,
 * `justfly.com` → 4.
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

export type DeactivateCustomerOptions = {
    email: string;
    password: string;
    /** Defaults to `process.env.BRAND` (or `'flighthub'`). */
    brand?: Brand;
};

/**
 * Best-effort: check `ota.customers.active = 0` for the given
 * (email, site_id) using a fresh MySQL connection. Returns `true` if
 * at least one row exists and **all** matching rows are deactivated.
 * Returns `false` otherwise. The "all rows" criterion handles the case
 * where a previous deactivate-then-resignup cycle has left multiple
 * rows behind for the same email.
 */
async function allCustomerRowsAreInactive(
    email: string,
    brand: Brand
): Promise<boolean> {
    const conn = await createConnection({
        host: process.env.MYSQL_HOST!,
        port: Number(process.env.MYSQL_PORT ?? 3306),
        user: process.env.MYSQL_USER!,
        password: process.env.MYSQL_PASSWORD!,
        database: process.env.MYSQL_DATABASE ?? 'ota',
    });

    try {
        const [rows] = await conn.execute(
            `SELECT COUNT(*) AS total, SUM(active) AS active_count
             FROM customers
             WHERE email = ? AND site_id = ?`,
            [email, brandSiteId(brand)]
        );

        const stats = (
            rows as Array<{ total: number; active_count: number }>
        )[0];
        return Number(stats.total) > 0 && Number(stats.active_count) === 0;
    } finally {
        await conn.end();
    }
}

/**
 * Self-deactivate the given genesis customer (sets
 * `ota.customers.active = 0`) via the deprecated but live
 * `Momentum\Account\App\Account::actionDeleteAccount` route, using a
 * fresh APIRequestContext to capture the PHPSESSID cookie that
 * `Mv_Ota_Jfly_App_StorefrontApi::actionLoginProcess` sets as a side
 * effect of the JWT-issuing call.
 *
 * Intended for `afterEach` / `afterAll` hooks of `@destructive` tests
 * that signed up a fresh per-test customer (typically using a
 * `+pwt-<uuid>@<brand>.com` alias) and need to free the email so the
 * test row does not leak into staging as `active = 1` indefinitely.
 *
 * @returns Nothing on success.
 * @throws If `login-init` does not return success, the MySQL secret
 *   lookup fails, `login-process` keeps returning the failure envelope
 *   after {@link MAX_DEACTIVATE_ATTEMPTS}, or the post-condition MySQL
 *   check still shows an `active = 1` row for this (email, brand).
 */
export async function deactivateCustomer(
    options: DeactivateCustomerOptions
): Promise<void> {
    const {
        email,
        password,
        brand = (process.env.BRAND as Brand | undefined) ?? 'flighthub',
    } = options;

    const apiUrl = (
        brand === 'flighthub' ? flighthubConfig.apiUrl : justflyConfig.apiUrl
    )!;
    const appUrl = (
        brand === 'flighthub' ? flighthubConfig.appUrl : justflyConfig.appUrl
    )!;

    const ctx = await playwrightRequest.newContext({
        baseURL: apiUrl,
        extraHTTPHeaders: genesisStorefrontAuthHeaders(
            appUrl,
            'pwt_deactivate'
        ),
    });

    let lastFailure = '';
    try {
        for (let attempt = 1; attempt <= MAX_DEACTIVATE_ATTEMPTS; attempt++) {
            const initRes = await ctx.post(ApiEndpoints.LOGIN_INIT, {
                data: { email, password },
            });
            if (initRes.status() !== 200) {
                throw new Error(
                    `deactivateCustomer: login-init returned status ${initRes.status()} on attempt ${attempt} for email='${email}' brand=${brand}`
                );
            }
            const initBody = (await initRes.json()) as {
                success?: boolean;
                error_message?: string;
            };
            if (initBody.success !== true) {
                throw new Error(
                    `deactivateCustomer: login-init failure envelope on attempt ${attempt} for email='${email}' brand=${brand}: ${JSON.stringify(initBody).slice(0, 240)}`
                );
            }

            const totp = await totpForCustomer(email, brand);

            const procRes = await ctx.post(ApiEndpoints.LOGIN_PROCESS, {
                data: { email, password, totp },
            });
            const procBody = (await procRes.json()) as {
                success?: boolean;
                token?: string;
                error_code?: number;
                error_message?: string;
            };

            if (procRes.status() === 200 && procBody.success === true) {
                // GET /account/delete-account on the same context — the
                // PHPSESSID cookie set by login-process's _authLogin() is
                // replayed automatically. Genesis redirects to /account on
                // success and to /account/my-profile on failure, so a 30x
                // pointing to /account is the success signal. The MySQL
                // post-condition is the authoritative check below.
                const delRes = await ctx.get(
                    `${appUrl}/account/delete-account`,
                    {
                        maxRedirects: 0,
                    }
                );
                if (delRes.status() < 300 || delRes.status() >= 400) {
                    throw new Error(
                        `deactivateCustomer: GET /account/delete-account returned ${delRes.status()} (expected a 30x redirect) for email='${email}' brand=${brand}`
                    );
                }

                if (!(await allCustomerRowsAreInactive(email, brand))) {
                    throw new Error(
                        `deactivateCustomer: post-condition failed — at least one ota.customers row for email='${email}' brand=${brand} still has active=1 after GET /account/delete-account`
                    );
                }

                return;
            }

            lastFailure = `attempt ${attempt}: status=${procRes.status()} body=${JSON.stringify(procBody).slice(0, 240)}`;
            if (procBody.error_code !== ERROR_CODE_TOTP_INVALID) {
                throw new Error(
                    `deactivateCustomer: login-process failed with non-retryable response — ${lastFailure}`
                );
            }
        }

        throw new Error(
            `deactivateCustomer: exhausted ${MAX_DEACTIVATE_ATTEMPTS} attempts; last response: ${lastFailure}`
        );
    } finally {
        await ctx.dispose();
    }
}
