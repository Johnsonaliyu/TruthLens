# TruthLens Naija

TruthLens Naija is a WhatsApp disinformation-checking assistant for Nigeria. It pairs a WhatsApp account through a QR code, checks text claims and images, searches published fact-checks and current web evidence, and replies with a verdict, confidence score, explanation, and source links.

## Project layout

- `artifacts/api-server` — Express API and Baileys WhatsApp worker
- `artifacts/truthlens-naija` — React/Vite operations dashboard
- `lib/api-spec` — OpenAPI source
- `lib/api-zod` — server-side generated schemas
- `lib/api-client-react` — frontend API client and React Query hooks

## Run locally

Requirements: Node.js 20+ and pnpm 10.

```bash
pnpm install
PORT=8080 pnpm --filter @workspace/api-server run dev
```

In a second terminal:

```bash
PORT=22566 BASE_PATH=/ pnpm --filter @workspace/truthlens-naija run dev
```

The API is available at `http://localhost:8080` and the dashboard at `http://localhost:22566`.

## Railway deployment

This repository includes `railway.json` for a single Railway service. It builds the dashboard and API, then serves the dashboard from the Express server. Railway supplies the runtime `PORT` automatically.

1. Create a Railway project from this GitHub repository.
2. Add these variables in the Railway service:
   - `GROQ_API_KEY`
   - `NVIDIA_API_KEY`
   - `GOOGLE_FACT_CHECK_API_KEY`
   - `TAVILY_API_KEY`
   - `NODE_ENV=production`
3. Deploy with the included configuration.
4. Open the Railway public domain and use **Start WhatsApp** to generate a QR code.
5. Attach a Railway persistent volume for the `.data` directory. Baileys stores the linked WhatsApp session there; without persistent storage, a restart requires pairing again.

Never commit real API keys, WhatsApp auth files, or `.env` files. Use `.env.example` as the variable-name reference.

## Verification

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/truthlens-naija run build
```