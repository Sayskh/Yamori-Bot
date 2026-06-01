import { getLangConfig } from '../core/configLoader';

export function t(key: string, replacements?: Record<string, string>, langCode?: string): string {
    const lang = getLangConfig(langCode);
    let text = lang[key] || key;
    if (replacements) {
        for (const [k, v] of Object.entries(replacements)) {
            text = text.replace(new RegExp(`{${k}}`, 'g'), v)
                       .replace(new RegExp(`@${k}`, 'g'), v);
        }
    }
    return text;
}
