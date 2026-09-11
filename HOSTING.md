# Hosting Survev Fireteam

How to run Survev Fireteam for friends on a VPS or home server.

Workflow:

1. Edit `survev-config.hjson`
2. `bun run build` (once after install or pull)
3. `bun run start`

Copy `survev-config.production.example.hjson` if you are starting from scratch.

Discord: https://discord.gg/w2MDPCpYqC

## Architecture

Survev Fireteam is not a single process. On one machine, `bun run start` launches what you enable in hjson:

| Process | Default port | Who connects | Public? |
|---------|--------------|--------------|---------|
| nginx | 80 / 443 | Players | Yes — only these should be open |
| API | 8000 | Browser via nginx (`/api`, `/team_v2`, `/private`) | No — localhost |
| Game manager | 8001 | Ping + session find | No — localhost |
| Match processes | 9000+ | Browser via nginx `/g/<port>/` | No — localhost |
| Optional SQL/Mongo | engine port | API only | No |

```text
Browser ──► nginx :443 ──► client/dist (static)
              │
              ├── /api, /private, /team_v2 ──► API :8000
              ├── /session/ ─────────────────► Game manager :8001
              ├── /ptc ──────────────────────► Game manager :8001
              └── /g/9000/play ──────────────► Match :9000
```

Matchmaking is ticket-based: the master API issues a short session ticket; the browser (or team lobby) completes find on `/session/find_game`, then joins the match WebSocket. A dead game node does not block other regions.

With nginx configured correctly you do **not** expose 8000, 8001, or 9000+.

### Dev over LAN / public IP (`bun run dev`)

`bun run dev` starts a wan-proxy on **port 3000** that tunnels everything:

| Path on `:3000` | Backend |
|-----------------|---------|
| `/` (site, `/api`, HMR) | Vite on `127.0.0.1:3100` |
| `/team_v2` | API `:8000` |
| `/session/` | Game manager `:8001` |
| `/ptc` | Game manager `:8001` |
| `/g/<port>/play` | Match process |

Only forward **3000**. Internal Vite stays on 127.0.0.1:3100.

Optional: set `SURVEV_ADVERTISE_HOST` or `game.url` so advertised addresses match what players use. In Vite DEV the client still forces session/match joins through the page origin so a live `game.url` cannot hijack local play.

## Bun

Runtime is **Bun** only (API, game, matches, scripts).

```sh
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun -v
```

No Node.js or pnpm is required to run the servers.

## Quick checklist (one VPS)

1. Ubuntu 22.04+ with ports 80 and 443 open.
2. Install Bun and nginx. Database is optional (SQLite is default).
3. Clone the repo, then:

```sh
bun install
bun run survev-setup
# edit survev-config.hjson
bun run build
```

4. Install nginx from `scripts/nginx-survev.conf.example`.
5. `bun run start` or enable the systemd unit below.
6. Share `https://your.domain`.

## Install (Ubuntu)

```sh
sudo apt -y update
sudo apt -y install git nginx curl unzip

curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### Database (optional)

Needed only for accounts / OAuth-backed features. Spec Ops leaderboards work on SQLite without Postgres.

```sh
sudo apt install -y postgresql
sudo systemctl enable --now postgresql
sudo -u postgres createuser survev
sudo -u postgres createdb survev -O survev
sudo -u postgres psql -c "ALTER USER survev WITH PASSWORD 'survev';"
```

Then set `database.engine` to `postgres` (or `mariadb` / `mongodb`) in hjson and migrate:

```sh
cd server
bun run db:migrate
```

## Build

```sh
cd /opt
git clone <your-fork-or-repo-url> survev
cd survev
bun install
bun run survev-setup
bun run build
```

## Example config

Prefer the compact templates:

- `survev-config.production.example.hjson`
- `survev-config.game-node.example.hjson`

Skeleton for a single live host:

```hjson
serverMode: "live"
proxyIPHeader: "X-Real-IP"

api: {
  enabled: true
  port: 8000
}

game: {
  enabled: true
  port: 8001
  firstMatch: 9000
  maxGames: 16
  id: "main"
  name: "Fireteam"
  url: "https://your.domain"
  address: "127.0.0.1:8001"
  mapName: "specops"
  difficulty: "regular"
  endless: true
  contractsEnabled: true
  maxSquadSize: 8
  modes: {
    solo: true
    duo: true
    squad: true
  }
}

client: {
  enabled: true
  port: 3000
}

database: {
  engine: "sqlite"
  sqlite: {
    path: "data/specops-local.db"
  }
}

secrets: {
  SURVEV_API_KEY: "CHANGE_ME_long_random"
  SURVEV_IP_SECRET: "CHANGE_ME_long_random"
}

rateLimitsEnabled: true
oauthRedirectURI: "https://your.domain"

debug: {
  enabled: false
}
```

Notes:

- `game.address` — API to game manager on this machine (`127.0.0.1:8001`).
- `game.url` — player-facing site URL (HTTPS domain). Match WS still tunnels through `/g/<port>/` on that host.
- Omit `bind` on a live single-host install so processes listen on `127.0.0.1` behind nginx. Set `bind: "0.0.0.0"` on child game nodes so the master can reach `:8001`.
- `SURVEV_API_KEY` must match on every master and child (min 16 characters).

## nginx

```sh
sudo cp /opt/survev/scripts/nginx-survev.conf.example /etc/nginx/sites-available/survev.conf
sudo nano /etc/nginx/sites-available/survev.conf
sudo chown -R www-data:www-data /opt/survev/client/dist
sudo unlink /etc/nginx/sites-enabled/default 2>/dev/null || true
sudo ln -s /etc/nginx/sites-available/survev.conf /etc/nginx/sites-enabled/survev.conf
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS:

```sh
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain
```

Required locations on the same server block:

| Path | Backend | Purpose |
|------|---------|---------|
| `/api` | `127.0.0.1:8000` | REST |
| `/private` | `127.0.0.1:8000` | Internal API (heartbeats, save_game) |
| `/team_v2` | `127.0.0.1:8000` | Team lobby WebSocket |
| `/session/` | `127.0.0.1:8001` | Session find_game (ticket completion) |
| `/ptc` | `127.0.0.1:8001` | Region ping WebSocket |
| `/g/9xxx/` | `127.0.0.1:9xxx` | Match WebSocket |

Also see `nginx.conf` at the repo root for a Pelican-style copy.

## Run

### Manual

```sh
cd /opt/survev
bun run start
```

Uses `NODE_ENV=production` and starts api / game / web according to hjson. If `client.enabled` is false, nginx should serve `client/dist` directly.

### systemd

```ini
# /etc/systemd/system/survev.service
[Unit]
Description=Survev Fireteam (from survev-config.hjson)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/survev
Environment=NODE_ENV=production
ExecStart=/home/YOUR_USER/.bun/bin/bun run start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now survev
sudo systemctl status survev
```

## Firewall

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Do not expose 8000, 8001, or 9000+ unless you intentionally skip the `/g/` and `/session/` proxies.

## Updating

```sh
cd /opt/survev
git pull
bun install
bun run build
sudo systemctl restart survev
```

## SQLite data

With `database.engine: "sqlite"`:

- Live file: `data/specops-local.db` (or `database.sqlite.path`)
- Daily backups under `data/db-backups/` (API midnight job; 90-day retention)
- Child nodes still push finished matches to the master via `/private/save_game`

Back up `data/` before wiping a host.

## Split deployment (master + game nodes)

```text
master.example.com     api + game + client   shared SURVEV_API_KEY
node1.example.com      game only             same key, game.apiUrl = master
node2.example.com      game only             same key
```

Players open the **master** website.

Game nodes:

1. Handshake once (`POST /private/handshake`)
2. Heartbeat about every 5s (`POST /private/update_region`) — player counts; stale after ~20s
3. Push match results (`POST /private/save_game`)

Join path: master issues a ticket; the browser talks to the child `/session/find_game`, then the child match WS. Each child needs nginx (or prod-web) for `/session/`, `/ptc`, and `/g/…`.

| Host | Config | Needs |
|------|--------|-------|
| Master | api/game/client enabled | One API key; own `game.id` / `name` / `url` / `address` |
| Game node | game only | `game.apiUrl` → master, same key, `address` reachable by master on `:8001`, `bind: "0.0.0.0"` |

Master sketch:

```hjson
api: { enabled: true, port: 8000 }
game: {
  enabled: true
  id: "main"
  name: "Fireteam"
  url: "https://master.example.com"
  address: "127.0.0.1:8001"
}
client: { enabled: true, port: 3000 }
secrets: { SURVEV_API_KEY: "shared-long-secret" }
```

Game node — use `survev-config.game-node.example.hjson`:

```hjson
bind: "0.0.0.0"
api: { enabled: false }
game: {
  enabled: true
  apiUrl: "https://master.example.com"
  id: "ft1"
  name: "Fireteam 1"
  url: "https://node1.example.com"
  address: "10.0.0.11:8001"
}
client: { enabled: false }
secrets: { SURVEV_API_KEY: "shared-long-secret" }
```

On each host: `bun run build` once, then `bun run start`.

For most friend groups, one VPS with everything enabled is simpler.

## Pelican / Wings node

Install Bun and nginx on the host. Keep API/game on localhost; expose only 80/443.

1. Repo at `/opt/survev` (or a volume).
2. `bun install && bun run build`
3. Edit `survev-config.hjson`: set `game.url` / `oauthRedirectURI`. Leave `serverMode: "live"`. Omit `bind` for localhost.
4. Install nginx from `nginx.conf` or `scripts/nginx-survev.conf.example`.
5. `bun run start` (or systemd).

If Survev runs inside an egg with published ports, set `bind: "0.0.0.0"` and point host nginx at those ports.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Site loads but cannot join | nginx missing `/g/`, `/session/`, or `/ptc`; rebuild client after protocol changes |
| Instant disconnect / invalid protocol | Stale build; run `bun run build` on API and game hosts |
| Everyone shares one IP / bans broken | Set `proxyIPHeader: "X-Real-IP"` and pass it in nginx |
| Region missing from Server list | Wrong `SURVEV_API_KEY`, unreachable `game.address`, or heartbeats older than ~20s |
| Empty leaderboard on SQLite | Scores live in `data/specops-local.db` on the **master**; children must push `save_game` |
| `bun run start` fails | Use Bun; ensure at least one of api/game/client is enabled; build client if `client.enabled` |
| Dev joins production hosts | Use `bun run dev` and open port 3000; Vite DEV keeps session local even if `game.url` is a live CDN |

## Bot (optional)

Discord bot features need a bot token in config and usually an accounts database (`database.engine` not sqlite). See bot package scripts in `bot/`.
