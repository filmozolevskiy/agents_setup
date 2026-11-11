import { request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

export interface ApiSession {
    ctx: APIRequestContext;
    dispose(): Promise<void>;
}

// Realistic Chrome User-Agent. Default Playwright UA triggers upstream
// supplier bot heuristics that strip non-GDS content sources (TravelFusion,
// etc.) from the response. See runners/_lib/browser.ts for the same constant.
const REAL_CHROME_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export async function createApiContext(baseURL: string): Promise<ApiSession> {
    const ctx = await playwrightRequest.newContext({
        baseURL,
        extraHTTPHeaders: { 'User-Agent': REAL_CHROME_UA },
    });
    return {
        ctx,
        dispose: (): Promise<void> => ctx.dispose(),
    };
}

export async function apiGet(
    ctx: APIRequestContext,
    path: string
): Promise<{ status: number; body: unknown }> {
    const response = await ctx.get(path);
    const status = response.status();
    let body: unknown = null;
    const ct = response.headers()['content-type'] ?? '';
    try {
        if (ct.includes('application/json')) {
            body = await response.json();
        } else {
            body = await response.text();
        }
    } catch {
        // ignore parse failures
    }
    return { status, body };
}
