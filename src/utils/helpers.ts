function formatDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString('id-ID', { hour12: false });
}

function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour >= 4 && hour < 11) return 'Pagi';
    if (hour >= 11 && hour < 15) return 'Siang';
    if (hour >= 15 && hour < 18) return 'Sore';
    return 'Malam';
}

export function replaceVariables(
    text: string,
    vars: {
        name?: string;
        user?: string;
        groupName?: string;
        itemName?: string;
        desc?: string;
        groupId?: string;
        prefix?: string;
        broadcastMsg?: string;
        totalMembers?: number;
        adminCount?: number;
        adminList?: string;
        announce?: string;
        restrict?: string;
        creationDate?: string;
        tag?: string;
    }
): string {
    const now = new Date();
    return text
        .replace(/@tag/gi, vars.tag || `@${vars.user || vars.name || 'User'}`)
        .replace(/@name/gi, vars.name || 'User')
        .replace(/@user/gi, vars.user || vars.name || 'User')
        .replace(/@groupName/gi, vars.groupName || 'Group')
        .replace(/@group/gi, vars.groupName || 'Group')
        .replace(/@time/gi, formatTime(now))
        .replace(/@date/gi, formatDate(now))
        .replace(/@greeting/gi, getGreeting())
        .replace(/@desc/gi, vars.desc || '')
        .replace(/@x/gi, vars.itemName || '')
        .replace(/@groupId/gi, vars.groupId || '')
        .replace(/\{prefix\}/gi, vars.prefix || '.')
        .replace(/@broadcastMsg/gi, vars.broadcastMsg || '')
        .replace(/@totalMembers/gi, vars.totalMembers?.toString() || '0')
        .replace(/@adminCount/gi, vars.adminCount?.toString() || '0')
        .replace(/@adminList/gi, vars.adminList || '-')
        .replace(/@announce/gi, vars.announce || '-')
        .replace(/@restrict/gi, vars.restrict || '-')
        .replace(/@creationDate/gi, vars.creationDate || '-');
}
