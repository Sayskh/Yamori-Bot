import 'dotenv/config';
import path from 'path';

const config = {
    prefix: process.env.PREFIX || '.',
    botName: process.env.BOT_NAME || 'BOT',
    sessionPath: process.env.SESSION_PATH || path.join(process.cwd(), 'data', 'sessions'),
    mediaPath: process.env.MEDIA_PATH || path.join(process.cwd(), 'data', 'media'),
    adminNumbers: (process.env.DEV || '').split(',').filter(Boolean),
    blockDms: process.env.BLOCK_DMS === 'true',
    language: process.env.LANGUAGE || 'en',
    enableCli: process.env.ENABLE_CLI === 'true',
    selfBot: process.env.SELF_BOT === 'false',
} as const;

export default config;