# FloodRoute Project Guidance

## Project
- React 18 and Vite frontend with resident, barangay, and admin portals.
- Supabase data access lives in `src/services` and `src/context/AdminDataContext.jsx`.
- Shared map components live in `src/components/admin` and `src/components/map`.
- Preserve the existing design and features. Reduce clutter through clear grouping, responsive layouts, and expandable secondary details.
- Official active warnings must remain visible and must not be contradicted by modeled flood estimates.

## Verification
- Run `npm run build` for frontend changes.
- Run `npm run check:functions` when changing shared services or Edge Functions.
- Start the local preview with `npm run dev -- --host 127.0.0.1 --port 5174`.
- `node scripts/check-ui.cjs` runs isolated browser checks with mocked Supabase responses. It needs Playwright, or `PLAYWRIGHT_MODULE` pointing to an available Playwright package.
- The UI runner supports `UI_BASE_URL`, `UI_BROWSER`, `AUDIT_WIDTHS`, comma-separated `AUDIT_ROUTE`, and optional `UI_TEST_3D=1`. Generated results stay in `tmp/`.
- Check small phones, tablets, and desktop layouts, including expanded panels, keyboard controls, and dialogs.

## Repository Hygiene
- Keep secrets, `.env` files, `credentials/`, Supabase scratch files, and unrelated thesis documents out of commits.
- Stage only files relevant to the requested change. Preserve unrelated local work.
- Validate before a requested push. Verify the remote commit and deployment status when publishing.
- Credit assistance on new work only; do not rewrite earlier authorship without an explicit history-rewrite request.

Codex reads this file as project guidance: [official documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
