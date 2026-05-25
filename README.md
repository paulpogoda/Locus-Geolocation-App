<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8698ead9-babb-4aa0-8225-387ff493d84a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy [.env.example](.env.example) to `.env.local` and set `GEMINI_API_KEY`. Optionally set `VITE_GEMINI_ANALYSIS_MODEL` and `VITE_GEMINI_CHAT_MODEL` (defaults: `gemini-2.5-flash` for both).
3. Run the app:
   `npm run dev`
