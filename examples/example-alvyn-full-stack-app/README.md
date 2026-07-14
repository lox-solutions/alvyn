# Nitro starter

Create your full-stack apps and deploy it anywhere with this [Vite](https://vite.dev/) + [Nitro](https://nitro.build/) starter.

## Getting started

```bash
npm install
npm run dev
```

### PostgreSQL Dev Container

`npm run dev` starts the app with a reusable PostgreSQL database using Docker (via Testcontainers) if `DATABASE_URL` is not set. The dev database container is named `alvyn-example-postgres-dev`. When the dev server stops, the container is stopped but kept, so the next start can reuse it without creating another container. The container lifecycle is managed by the Vite dev-server lifecycle, so no extra process is needed to run Vite.

To remove the reusable dev database manually:

```bash
docker rm -f alvyn-example-postgres-dev
```

Tests use their own independent Testcontainers setup and do not use this dev database. `docker ps -a` can be used to see the stopped reusable container.

## Deploying

```bash
npm run build
npm run preview
```

Then checkout the [Nitro documentation](https://nitro.build/deploy) to learn more about the different deployment presets.
