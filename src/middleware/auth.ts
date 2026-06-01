import config from '../config';
import { GroupParticipant } from 'baileys';
import { normalizeJid, extractNumericId } from '../utils/jid';

export function isBotAdmin(sender: string): boolean {
    const senderNumber = sender.split('@')[0].replace(/\D/g, '');
    return config.adminNumbers.some(admin => {
        const adminNumber = admin.split('@')[0].replace(/\D/g, '');
        return adminNumber.length > 0 && senderNumber === adminNumber;
    });
}

export function isGroupAdmin(participants: GroupParticipant[], sender: string): boolean {
    const senderNorm = normalizeJid(sender);
    const senderNum = extractNumericId(sender);

    const participant = participants.find((p: any) => {
        const pid = p?.id || '';
        if (!pid) return false;

        const pidNorm = normalizeJid(pid);
        if (pidNorm === senderNorm) return true;

        const pidNum = extractNumericId(pid);
        if (senderNum.length > 0 && pidNum.length > 0 && pidNum === senderNum) return true;

        // Cross-domain: check participant.lid (LID format) and participant.phoneNumber (PN format)
        // This handles Multi-Device where id is @lid but sender is @s.whatsapp.net (or vice-versa)
        const altJids: string[] = [p?.lid, p?.phoneNumber].filter(Boolean);
        for (const alt of altJids) {
            const altNorm = normalizeJid(alt);
            if (altNorm === senderNorm) return true;

            const altNum = extractNumericId(alt);
            if (senderNum.length > 0 && altNum.length > 0 && altNum === senderNum) return true;
        }

        return false;
    });

    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
}
