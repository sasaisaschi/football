# Narration API (optional, Microsoft Foundry)

**Status: prepared, not deployed, never run against Azure.** The game and its match intelligence work completely without it: every insight is worded locally in two languages and two modes. This function only adds an optional AI rewording.

## What it does

`POST /api/narrate` takes one insight. The body holds `kind`, `mode` (`fan` or `analyst`), `lang` (`en` or `de`) and `facts`, which is the insight's own numbers and names. The function asks a model deployed in a Microsoft Foundry project to word it, then returns `{ text, model }`.

The rules live in `src/intel/foundry/narrate-core.ts` and are unit-tested in `foundry.test.ts`:

- Requests must be small, flat and of a known kind.
- 20 requests per client per 10 minutes, and 2000 per day per instance.
- `max_tokens` 120, temperature 0.4.
- Any answer that contains a number not present in the facts is rejected (HTTP 422). The app then keeps its own text.

## Security

- No API key exists. The Function App authenticates to Foundry with its **managed identity** through `DefaultAzureCredential`.
- The browser only knows this function's public URL (`VITE_NARRATION_URL` at build time).
- CORS allows only the origin set in `ALLOWED_ORIGIN`.

## Setup (to do, needs an Azure subscription)

1. Create a Foundry project and deploy a chat model.
2. Create a Function App (Node 20+, Functions v4) with a system-assigned managed identity. Grant that identity the *Azure AI User* role on the Foundry project.
3. Set these app settings:
   - `FOUNDRY_PROJECT_ENDPOINT`
   - `FOUNDRY_MODEL_DEPLOYMENT`
   - `ALLOWED_ORIGIN`, for example `https://sasaisaschi.github.io`
   - optionally `FOUNDRY_API_VERSION`
4. From this folder, run `npm install`, `npm run build` and then `func azure functionapp publish <app-name>`.
5. Build the web app with `VITE_NARRATION_URL=https://<app-name>.azurewebsites.net/api/narrate npm run build`.

Until these steps are done and checked, the cloud integration is open. It is not claimed as working.
