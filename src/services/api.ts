import log from '../utils/logger';
const API_BASE = process.env.API_URL;
const TIMEOUT_MS = 30000;

const alog = log.child({ module: 'api' });

export class ApiError extends Error {
    constructor(public statusCode: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

export async function fetchAPI(endpoint: string, body: Record<string, any> = {}): Promise<any> {
    if (!API_BASE) {
        throw new ApiError(500, 'API_URL belum diset di environment');
    }

    const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const url = `${API_BASE}${path}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new ApiError(response.status, `API Error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    } catch (err: any) {
        if (err.name === 'AbortError') {
            throw new ApiError(408, 'Request timeout');
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function downloadMedia(platform: string, url: string): Promise<any> {
    const data = await fetchAPI(`/download/${platform}`, { url });

    if (!data?.status || !data?.result?.success) {
        return null;
    }

    return data.result;
}
