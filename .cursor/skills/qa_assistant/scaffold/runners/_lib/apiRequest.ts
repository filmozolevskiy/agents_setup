import { request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

export interface ApiSession {
    ctx: APIRequestContext;
    dispose(): Promise<void>;
}

export async function createApiContext(baseURL: string): Promise<ApiSession> {
    const ctx = await playwrightRequest.newContext({ baseURL });
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
