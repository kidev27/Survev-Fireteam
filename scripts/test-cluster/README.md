# Local multi-node test harness

`start.mjs` expects sibling folders with `survev-config.hjson`:

- `master/` — API only (`api.enabled: true`, `game.enabled: false`)
- `ft1/`, `ft2/`, `ft3/` — game nodes pointing `game.apiUrl` at `http://127.0.0.1:8000`

Use unique `game.port` / `game.firstMatch` / `game.id` per child. Copy placeholders from the repo-root example hjson files and set the same `SURVEV_API_KEY` everywhere.

Those local configs are gitignored (they contain secrets).

```sh
bun scripts/test-cluster/start.mjs
SURVEV_API_KEY=your-key bun scripts/test-3child-load.ts
```
