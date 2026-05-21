const fs = require('node:fs');
const path = require('node:path');

function loadEnvLocal(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ecosystem: required env file not found: ${filePath}`);
  }
  const out = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = loadEnvLocal(path.join(__dirname, '.env.local'));
if (!env.AGENTGUARD_TOKEN) {
  throw new Error('ecosystem: AGENTGUARD_TOKEN missing in .env.local');
}

module.exports = {
  apps: [{
    name: 'gijun-ai-server',
    script: './packages/server/dist/server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    restart_delay: 3000,
    max_restarts: 50,
    min_uptime: '60s',
    env: {
      NODE_ENV: 'production',
      AGENTGUARD_TOKEN: env.AGENTGUARD_TOKEN,
      AGENTGUARD_DB_PATH: path.join(__dirname, 'gijun.db'),
      AGENTGUARD_PORT: '3456',
    },
  }],
};
