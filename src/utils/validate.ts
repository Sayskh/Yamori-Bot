export function extractInviteCode(url: string): string | null {
    const match = url.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    return match ? match[1] : null;
}

