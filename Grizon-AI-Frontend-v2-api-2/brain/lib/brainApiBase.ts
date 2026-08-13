/**
 * Brain API URLs for browser (Next proxy) vs server.
 * Browser: /api/brain/* → rewrites to Brain backend (avoids CORS / connection errors).
 */
export function getBrainApiUrl(path: string): string {
    const normalized = path.replace(/^\/?brain\/?/i, '').replace(/^\//, '');
    if (typeof window !== 'undefined') {
        return `/api/brain/${normalized}`;
    }
    const base = (process.env.NEXT_PUBLIC_BRAIN_API_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
    return `${base}/brain/${normalized}`;
}

export async function brainApiFetch(path: string, init?: RequestInit, retries = 2): Promise<Response | null> {
    let lastErr: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(getBrainApiUrl(path), {
                ...init,
                cache: 'no-store',
                signal: init?.signal,
            });
            return res;
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                throw err;
            }
            lastErr = err;
            if (attempt < retries) {
                // Backend can briefly block (e.g. a long sandbox deploy) — retry with backoff.
                await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
        }
    }
    console.error(`[brainApiFetch] ${path} failed:`, lastErr?.constructor?.name, lastErr);
    return null;
}
