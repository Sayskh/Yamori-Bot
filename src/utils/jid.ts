export function normalizeJid(jid: string): string {
    if (!jid) return '';
    const [userPart, domain = 's.whatsapp.net'] = jid.split('@');
    const user = userPart.includes(':') ? userPart.split(':')[0] : userPart;
    return `${user}@${domain}`.toLowerCase();
}

export function extractNumericId(jid: string): string {
    const normalized = normalizeJid(jid);
    const user = normalized.split('@')[0];
    return user.replace(/\D/g, '');
}

export function normalizeBotId(sock: { user?: { id: string } }): string {
    let botId = sock.user?.id || '';
    if (botId.includes(':')) botId = botId.split(':')[0];
    if (!botId.endsWith('@s.whatsapp.net')) botId += '@s.whatsapp.net';
    return botId.replace(/@s\.whatsapp\.net@s\.whatsapp\.net/g, '@s.whatsapp.net');
}
