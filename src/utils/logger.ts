import 'dotenv/config';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const logDir = path.join(process.cwd(), 'data', 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const isDev = process.env.NODE_ENV !== 'production';

// We use pino-pretty for stdout and writing to file
const transport = pino.transport({
    targets: [
        {
            target: 'pino-pretty',
            options: {
                destination: 1, // stdout
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
                singleLine: true,
                messageFormat: '{module} - {msg}'
            },
            level: process.env.LOG_LEVEL || 'info',
        },
        {
            target: 'pino-pretty',
            options: {
                destination: path.join(logDir, 'bot.log'),
                colorize: false,
                translateTime: 'yyyy-mm-dd HH:MM:ss',
                ignore: 'pid,hostname',
                singleLine: true,
                messageFormat: '{module} - {msg}'
            },
            level: process.env.LOG_LEVEL || 'info',
        }
    ]
});

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
}, transport);

export default logger;
