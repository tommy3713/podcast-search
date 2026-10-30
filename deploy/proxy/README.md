# Shared reverse proxy (Caddy) on the VPS

Every app on the VPS (Vultr, Ubuntu 24.04, 1 vCPU / 2 GB RAM + 4.9 GB swap, `deploy@66.245.221.163`,
ssh key `~/.ssh/gooaye_vps`) sits behind one Caddy. Caddy is the only container that publishes
ports (80/443); it picks the app by domain (TLS SNI and the `Host` header) and gets certificates
from Let's Encrypt automatically.

```
internet ─80/443─▶ caddy (/opt/proxy) ─┬─ gooaye-web:3000   (/opt/gooaye)
                                        └─ <app>-web:<port>  (/opt/<app>)
                       all on the external docker network `proxy`
```

## Layout on the VPS

```
/opt/proxy/
  compose.yml      # this directory's compose.yml (project name `proxy`)
  Caddyfile        # only `import sites/*.caddy`
  sites/<app>.caddy  # one file per app, owned and uploaded by that app's deploy script
/opt/<app>/        # each app's own compose project, env files and data
```

The proxy config lives in this repo (`podcast-search/deploy/proxy/`) for now. Change it with
`deploy/proxy/deploy.sh`; app deploys never touch `compose.yml` or `Caddyfile` here.

## Adding an app

1. Build images in CI and pull them on the VPS; never build on the VPS (2 GB RAM).
2. In the app's compose file, put the public-facing service on the `proxy` network under an alias
   prefixed with the app name (service names like `web` collide across projects). Do not add
   `ports:`: Docker-published ports bypass ufw.

   ```yaml
   services:
     web:
       image: ghcr.io/tommy3713/<app>-web:latest
       restart: unless-stopped
       mem_limit: 384m
       networks:
         proxy:
           aliases: [<app>-web]

   networks:
     proxy:
       external: true
   ```

   Listing `networks:` on a service drops it from the project's default network; add `default`
   too if it must reach other services in its own project (a database, a worker).
3. Write `<app>.caddy` in the app's repo:

   ```
   <app>.example.com {
   	encode zstd gzip
   	reverse_proxy <app>-web:3000
   }
   ```
4. Point the domain's DNS A record at the VPS IP before the first deploy, or certificate
   issuance fails.
5. Deploy script: `scp` the compose file to `/opt/<app>/` and `<app>.caddy` to `/opt/proxy/sites/`,
   `docker compose up -d` in `/opt/<app>`, then reload Caddy. `deploy/deploy.sh` in this repo is
   the reference.

   ```bash
   docker compose -f /opt/proxy/compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile
   ```

`/opt` is root-owned: create `/opt/<app>` once with `sudo install -d -o deploy -g deploy /opt/<app>`.

## Rules

- A broken site file fails `caddy reload` (the running config stays), but if Caddy restarts with it
  every site on the VPS goes down. Fix or remove it right away; check with
  `docker compose -f /opt/proxy/compose.yml exec caddy caddy validate --config /etc/caddy/Caddyfile`.
- Removing an app: delete its `sites/<app>.caddy`, reload Caddy, then `docker compose down` in
  `/opt/<app>`.
- Memory is shared: set `mem_limit` on every container and check `free -m` before adding one.
- Logs: `docker logs proxy-caddy-1`.
