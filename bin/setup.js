#!/usr/bin/env node
const { execSync } = require('child_process');

async function run() {
    await import('../src/setup/index.js');
}

if (process.argv[2] === 'stop') {
    execSync('docker-compose stop');
}
else run();
