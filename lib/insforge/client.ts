import { createBrowserClient } from "@insforge/sdk/ssr";

// Browser client for Client Components (database, storage, realtime).
// Auth mutations run on the server — see app/(auth)/actions.ts.
export const insforge = createBrowserClient();
