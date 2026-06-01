const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 2000;

export function isRateLimited(sender: string): boolean {
    const now = Date.now();
    const last = cooldowns.get(sender);

    if (last && now - last < COOLDOWN_MS) {
        return true;
    }

    cooldowns.set(sender, now);

    if (cooldowns.size > 500) {
        const cutoff = now - COOLDOWN_MS * 2;
        for (const [key, time] of cooldowns) {
            if (time < cutoff) cooldowns.delete(key);
        }
    }

    return false;
}

setInterval(() => {
    const cutoff = Date.now() - COOLDOWN_MS * 2;
    for (const [key, time] of cooldowns) {
        if (time < cutoff) cooldowns.delete(key);
    }
}, 5 * 60 * 1000).unref();
