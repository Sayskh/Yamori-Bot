import 'dotenv/config';
import database from './core/database';
import { MultiSessionManager } from './core/multiSessionManager';

let manager: MultiSessionManager | null = null;

async function shutdown(signal: string) {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main() {
    try {
        await database.init();

        manager = new MultiSessionManager();
        const args = process.argv.slice(2);
        const addIndex = args.findIndex(a => a === '--add' || a === 'add');

        if (addIndex !== -1) {
            const sessionName = args[addIndex + 1];
            const phoneNumber = args[addIndex + 2];

            if (!sessionName) {
                console.error('Usage: npm start add <session_name> [phone_number]');
                process.exit(1);
            }

            await manager.init();
            await manager.addSession(sessionName, phoneNumber);
        } else {
            await manager.init();
        }
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

main();
