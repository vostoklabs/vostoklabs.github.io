# Docker: build & avvio di Keycap Legend Generator

Guida per compilare ed eseguire l'app in un container Docker.

## Architettura della solution

`keycap-generator` fa parte di un **monorepo pnpm** e dipende da:

- pacchetti workspace: `@vostok/brand`, `@vostok/export`, `@vostok/plates`, `@vostok/ui-kit`
- `packages/manifold-noeval` (rebuild vendored di manifold-3d, risolto via alias in `vite.config.js`)
- dipendenze npm pubbliche (`three`, `manifold-3d`, `fflate`, `lucide`, …)

Per questo il **build context di Docker è la root del monorepo** (`../..`), non la cartella dell'app:
le dipendenze `workspace:*` vengono risolte da `pnpm-workspace.yaml` e dal `pnpm-lock.yaml` di root.

## File

| File | Ruolo |
| --- | --- |
| `Dockerfile` | Build multi-stage (node:22-alpine → build → nginx:1.27-alpine) |
| `docker-compose.yml` | Orchestrazione: contesto `../..`, porta `8080:80`, restart automatico |
| `nginx.conf` | Config nginx: SPA fallback, gzip, cache per wasm/json/font/3mf |
| `.dockerignore` (root repo) | Esclude node_modules, dist, docs, .git ecc. dal contesto |

## Prerequisiti

- Docker Engine (con BuildKit) e Docker Compose v2:
  ```bash
  docker --version
  docker compose version
  ```
- Nessuna dipendenza locale richiesta: la build gira interamente dentro il container
  (pnpm 10.8.1 pinato via `corepack`).

## Comandi

Tutti i comandi vanno eseguiti da `apps/keycap-generator` (dove sta il `docker-compose.yml`).

### Build + avvio

```bash
docker compose up -d
```

### Solo build (senza avviare)

```bash
docker compose build
```

### Stop (mantiene l'immagine)

```bash
docker compose down
```

### Stop e rimozione container

```bash
docker compose down --rmi local
```

### Log

```bash
docker compose logs -f
```

## Accesso

- App: <http://localhost:8000>
- La porta host è configurabile in `docker-compose.yml`:
  ```yaml
  ports:
    - "8000:80"   # <host>:<container>
  ```

## Verifica

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/        # atteso: 200
curl -s http://localhost:8080/ | grep -i "<title>"                     # Keycap Legend Generator
```

## Note

- **Prestazioni build**: `pnpm install --frozen-lockfile` installa l'intero workspace (19 progetti)
  perché il lockfile di root li riferisce tutti; la build prodotta è solo di `keycap-generator`
  (`apps/keycap-generator/dist`).
- **Peso del contesto**: il `.dockerignore` di root tiene il contesto a ~110 MB. Se la build
  risulta lenta, è normale al primo giro (download di `node:22-alpine` e `nginx`).
- **Cache**: i layer `node:22-alpine` e `nginx` vengono riusati tra una build e l'altra; il layer
  `COPY . .` si invalida a ogni modifica del sorgente.
- **CSP / WASM**: `manifold-noeval` carica il proprio `.wasm` senza `new Function()`, quindi la
  build resta compatibile anche con host che impongono `script-src` senza `unsafe-eval`.
- **MakerWorld**: il container builda il profilo *pubblico* (senza SDK MakerLab, senza `src/pro`),
  gli stessi sorgenti `apps/*/makerlab/` e `apps/*/src/pro/` sono gitignored. Per la build
  MakerWorld esiste `build:mw` / `pack:mw`, non coperta dal container.