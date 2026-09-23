module.exports = {
  apps: [{
    name: "vip-gece-site",
    script: "./server.modular.js",
    cwd: "/var/www/vip-gece-site/current",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "512M",
    min_uptime: "10s",
    max_restarts: 10,
    restart_delay: 2000,
    exp_backoff_restart_delay: 100,
    kill_timeout: 10000,
    listen_timeout: 15000,
    env: {
      NODE_ENV: "production",
      PORT: "3003",
      HOST: "127.0.0.1",
      DOTENV_CONFIG_PATH: "/var/www/vip-gece-site/.env"
    },
    error_file: "/var/log/vip-gece/pm2-error.log",
    out_file: "/var/log/vip-gece/pm2-out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    merge_logs: true
  }]
};
