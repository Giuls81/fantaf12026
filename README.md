<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FantaF1 2026 - Serverless & Admin

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1qkzFaW0a0uHKWAv5siBwVLcUhWYZO2ZT

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Live Updates (Capgo OTA)

The app is configured for Capacitor live updates with `@capgo/capacitor-updater`.
This lets you ship **web-only fixes** (JS/HTML/CSS/assets) without a full App Store / Play Store binary release.

### What still requires store release

- Native code or plugins
- iOS/Android manifest or permission changes
- Build number/version changes

### One-time setup

1. Create Capgo API key in your Capgo account.
2. Initialize app once:
   `npx @capgo/cli@latest init YOUR_CAPGO_API_KEY com.fantaf1.app`
3. Save CI/local secrets:
   - `CAPGO_API_KEY`
   - `CAPGO_APP_ID` (usually `com.fantaf1.app`)
   - optional `CAPGO_CHANNEL` (default: `production`)

### Upload an OTA update (local)

PowerShell example:

```powershell
$env:CAPGO_API_KEY="YOUR_KEY"
$env:CAPGO_APP_ID="com.fantaf1.app"
$env:CAPGO_CHANNEL="production"
npm run ota:upload
```

### Upload an OTA update (Codemagic)

Use workflow: `OTA Live Update (Capgo)` in `codemagic.yaml`.
It builds `web/dist` and uploads the bundle with delta mode.
