module.exports = {
    apps: [
        {
            name: 'bot',
            script: 'dist/index.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '300M',
            restart_delay: 3000,
            env: {
                NODE_ENV: 'production',
            },
        },
    ],
};
