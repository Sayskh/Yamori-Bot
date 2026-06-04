import { Command } from '../../types/Command';
import log from '../../utils/logger';

const command: Command = {
    name: 'add',
    description: 'Add member to group',
    usage: '<number> [number2 ...]',
    groupAdminOnly: true,
    async execute(sock, msg, args, context) {
        const from = msg.key.remoteJid!;
        const { t } = context;
        const isGroup = from.endsWith('@g.us');

        if (!isGroup) {
            await sock.sendMessage(from, { text: t('group_only') });
            return;
        }

        if (args.length === 0) {
            await sock.sendMessage(from, { text: t('add_usage') });
            return;
        }

        try {
            const groupMetadata = await sock.groupMetadata(from);
            const participants = groupMetadata.participants;

            const results = {
                success: [] as string[],
                failed: [] as { number: string, reason: string }[],
                alreadyMember: [] as string[]
            };

            for (const arg of args) {
                try {
                    let phoneNumber = arg.replace(/[^0-9]/g, '');

                    if (phoneNumber.length < 8) {
                        results.failed.push({
                            number: phoneNumber,
                            reason: t('invalid_number')
                        });
                        continue;
                    }

                    if (phoneNumber.length <= 10 && !phoneNumber.match(/^(1|7|2[0-9]|3[0-9]|4[0-9]|5[0-9]|6[0-9]|8[0-9]|9[0-9])/)) {
                        phoneNumber = '62' + phoneNumber;
                    }

                    const userJid = phoneNumber + '@s.whatsapp.net';
                    const isAlreadyMember = participants.some(p => p.id === userJid);

                    if (isAlreadyMember) {
                        results.alreadyMember.push(phoneNumber);
                        continue;
                    }

                    const response = await sock.groupParticipantsUpdate(from, [userJid], 'add');

                    if (response[0]?.status === '403') {
                        results.failed.push({ number: phoneNumber, reason: t('privacy_setting') });
                    } else if (response[0]?.status === '408') {
                        results.failed.push({ number: phoneNumber, reason: t('left_recently') });
                    } else if (response[0]?.status === '409') {
                        results.alreadyMember.push(phoneNumber);
                    } else {
                        results.success.push(phoneNumber);
                    }

                } catch (err) {
                    results.failed.push({ number: arg, reason: t('failed') });
                }
            }

            let responseText = `${t('add_result')}\n\n`;

            if (results.success.length > 0) {
                responseText += `${t('add_success')} (${results.success.length}):\n`;
                results.success.forEach(num => responseText += `• @${num}\n`);
                responseText += '\n';
            }

            if (results.alreadyMember.length > 0) {
                responseText += `${t('add_already_member')} (${results.alreadyMember.length}):\n`;
                results.alreadyMember.forEach(num => responseText += `• ${num}\n`);
                responseText += '\n';
            }

            if (results.failed.length > 0) {
                responseText += `${t('add_failed')} (${results.failed.length}):\n`;
                results.failed.forEach(item => responseText += `• ${item.number} - ${item.reason}\n`);
            }

            const mentions = results.success.map(num => num + '@s.whatsapp.net');

            await sock.sendMessage(from, {
                text: responseText,
                mentions: mentions
            });

        } catch (error) {
            log.error({ err: error }, 'Add command error');
            await sock.sendMessage(from, { text: t('add_fail_process') });
        }
    }
};

export default command;
