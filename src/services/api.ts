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

export async function downloadMedia(platform: string, url: string): Promise<any> {
    if (!API_BASE) {
        throw new ApiError(500, 'API_URL belum diset di environment');
    }

    // Trim trailing slash from API_BASE if present to ensure clean URL
    const baseUrl = API_BASE.endsWith('/') ? API_BASE : `${API_BASE}/`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url,
                videoQuality: '1080',
                filenameStyle: 'basic',
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            let errMsg = `API Error: ${response.status} ${response.statusText}`;
            try {
                const errData = await response.json();
                if (errData?.error?.code) {
                    const code = errData.error.code;
                    if (code.includes('auth.jwt') || code.includes('auth.key') || code.includes('jwt')) {
                        errMsg = 'Cobalt Instance memerlukan autentikasi/JWT (seperti Turnstile). Silakan gunakan instance publik lain atau host sendiri.';
                    } else {
                        errMsg = `Cobalt Error: ${code}`;
                    }
                }
            } catch {}
            throw new ApiError(response.status, errMsg);
        }

        const data = (await response.json()) as any;

        if (data.status === 'error') {
            let errMsg = `Cobalt Error: ${data.error?.code || 'unknown'}`;
            const code = data.error?.code || '';
            if (code.includes('auth.jwt') || code.includes('auth.key') || code.includes('jwt')) {
                errMsg = 'Cobalt Instance memerlukan autentikasi/JWT (seperti Turnstile). Silakan gunakan instance publik lain atau host sendiri.';
            }
            throw new ApiError(400, errMsg);
        }

        if (data.status === 'redirect' || data.status === 'tunnel') {
            const filename = data.filename || '';
            const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(filename) || /\.(jpg|jpeg|png|webp|gif)/i.test(data.url);
            const mediaType = isImage ? 'image' : 'video';

            return {
                type: mediaType,
                title: data.filename || '',
                author: '',
                media: [
                    {
                        type: mediaType,
                        url: data.url
                    }
                ]
            };
        }

        if (data.status === 'picker') {
            const media = data.picker.map((item: any) => {
                const itemType = (item.type === 'photo' || item.type === 'image') ? 'image' : 'video';
                return {
                    type: itemType,
                    url: item.url
                };
            });

            return {
                type: 'carousel',
                title: '',
                author: '',
                media
            };
        }

        throw new ApiError(500, `Unsupported Cobalt status: ${data.status}`);
    } catch (err: any) {
        alog.error({ err, url }, 'Gagal mengunduh media dari Cobalt API');
        if (err.name === 'AbortError') {
            throw new ApiError(408, 'Request timeout');
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}
