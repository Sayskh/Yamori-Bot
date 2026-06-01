import { WASocket, GroupMetadata } from 'baileys';

interface CacheEntry {
    data: GroupMetadata;
    timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 50;

const cache = new Map<string, CacheEntry>();

export async function getGroupMetadata(sock: WASocket, groupId: string): Promise<GroupMetadata> {
    const now = Date.now();
    const entry = cache.get(groupId);

    if (entry && (now - entry.timestamp < CACHE_TTL)) {
        return entry.data;
    }

    if (cache.size >= MAX_CACHE_SIZE) {
        let evicted = false;
        for (const [key, val] of cache.entries()) {
            if (now - val.timestamp >= CACHE_TTL) {
                cache.delete(key);
                evicted = true;
            }
        }
        if (!evicted) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey) cache.delete(oldestKey);
        }
    }

    const data = await sock.groupMetadata(groupId);
    cache.set(groupId, { data, timestamp: now });
    return data;
}

export function invalidateGroupCache(groupId: string): void {
    cache.delete(groupId);
}

