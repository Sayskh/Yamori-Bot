# Yamori WhatsApp Bot

Yamori is a high-performance, multi-session WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys). Designed with a modern TypeScript architecture, it prioritizes stability, efficient multi-session handling, and provides a professional CLI dashboard for monitoring and management.

Suitable for personal use, group moderation, and production deployments.

## Architecture & Features

- **Multi-Session Management**: Run and manage multiple WhatsApp bot instances within a single Node.js process.
- **Advanced CLI Dashboard**: Monitor connection states, memory heap usage, total messages processed, and uptime per session in real-time via the terminal.
- **SQLite Storage**: Lightweight, local SQLite database for persisting state and group configurations (welcome/goodbye messages, anti-link rules).
- **Dynamic Configuration**: Centralized configuration for menus and templates via `.yml` files in `src/config/`. Changes apply without requiring a process restart.
- **Group Moderation**: Automated group management, including an anti-link system that detects and removes members violating link rules.
- **Media Conversion**: Built-in sticker generation from images and short videos utilizing `ffmpeg` and `node-webpmux`. Conversion algorithms are optimized to stay within strict memory and file-size constraints for cross-platform (iOS/Android) compatibility.
- **Structured Logging**: Utilizing `pino` for both formatted console output and persistent file logging (`data/logs/bot.log`).

## System Requirements

Ensure the following dependencies are installed on the host system:
- **Node.js**: v20.0.0 or higher.
- **FFmpeg**: Required for media processing and sticker conversion.

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Sayskh/Yamori-Bot.git
   cd Yamori-Bot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Create a `.env` file in the project root:
   ```env
   NODE_ENV=development
   LOG_LEVEL=info
   
   # Required for the .download feature (TikTok, IG, Twitter, YouTube):
   API_URL=https://api.example.com
   ```
   > **Note on `API_URL`**: The `.download` feature (`src/commands/utils/download.ts`) relies on an external API backend (`src/services/api.ts`) to fetch social media links. You must provide a valid API endpoint that returns the expected JSON structure for downloads to work.

## Usage

For development (with hot-reloading via nodemon):
```bash
npm run dev
```

For production deployment:
```bash
npm run build
npm start
```

### Initializing a Session

Once the bot manager is running, use the built-in CLI to initialize a new WhatsApp session:
```
bot> :add <session_name>
```
Scan the generated QR Code using the linked devices feature in the WhatsApp application.

Alternatively, initialize a session on boot:
```bash
npm start add <session_name>
```

## CLI Commands

The Yamori interactive CLI supports the following commands:

| Command | Description |
|---|---|
| `:status` | Displays the advanced dashboard (memory, sessions, metrics). |
| `:add <name>` | Initializes and pairs a new WhatsApp session. |
| `:del <name>` | Permanently deletes a session and clears its local state. |
| `:restart <name>`| Restarts a specific session process. |
| `:clean` | Removes all sessions currently in a `Disconnected` state. |
| `:logs [n]` | Tails the last *n* lines of the system log (default: 10). |
| `:clear` | Clears the terminal buffer. |
| `:exit` | Gracefully terminates the bot process. |

## Configuration Structure

Templates and configurations are managed via YAML files located in `src/config/`:
- `admin.yml`: Group moderation templates (welcome, goodbye, promote, kick).
- `menu.yml`: Command categorization, labels, and menu structures.
- `dev.yml`: Broadcast templates and developer-specific settings.

## Contributing

Pull requests are welcome. For major architectural changes, please open an issue first to discuss the proposed modifications.

## License

This project is licensed under the [MIT License](LICENSE).
