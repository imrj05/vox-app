import PocketBase, { type RecordModel } from "pocketbase";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { withTimeout } from "@/lib/async";

/**
 * PocketBase server URL. Override with `VITE_POCKETBASE_URL` in `.env`.
 * Defaults to the local PocketBase dev server.
 */
export const POCKETBASE_URL =
  import.meta.env.VITE_POCKETBASE_URL ?? "http://127.0.0.1:8090";

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Product identity reported to PocketBase for analytics (best-effort). */
export const APP_NAME = "Vox";
export const APP_VERSION = __APP_VERSION__;

let _pb: PocketBase | null = null;

/** Returns the app-wide PocketBase client (singleton). */
export function getPocketBase(): PocketBase {
  if (!_pb) {
    _pb = new PocketBase(POCKETBASE_URL);
  }
  return _pb;
}

/** The currently authenticated user record, or null. */
export function getAuthUser(): RecordModel | null {
  return getPocketBase().authStore.record ?? null;
}

/** Whether a valid auth token is present locally. */
export function isAuthenticated(): boolean {
  return getPocketBase().authStore.isValid;
}

/**
 * Validate any persisted token against the server and refresh the user
 * record. Clears the token if it is missing or no longer valid.
 */
export async function initAuth(): Promise<RecordModel | null> {
  const pb = getPocketBase();
  if (!pb.authStore.token) return null;
  try {
    const response = await withTimeout(
      pb.collection("users").authRefresh(),
      8000,
      "Timed out validating the saved session."
    );
    // Keep analytics fields current on every launch.
    await syncAnalyticsFields(response.record.id);
    return response.record;
  } catch {
    pb.authStore.clear();
    return null;
  }
}

/**
 * Sign in with GitHub through PocketBase OAuth2.
 *
 * PocketBase's `authWithOAuth2` initializes a one-off realtime subscription and
 * hands us the vendor URL via `urlCallback`. We open that URL in the user's
 * default browser; once they authorize, PocketBase delivers the auth result
 * back over the realtime connection and the promise resolves. The app window
 * is focused again so the user lands back in Vox.
 */
export async function signInWithGithub(): Promise<RecordModel> {
  const pb = getPocketBase();
  const requestKey = `github-oauth-${Date.now()}`;

  const flow = pb.collection("users").authWithOAuth2({
    provider: "github",
    requestKey,
    createData: {
      app_name: APP_NAME,
      app_version: APP_VERSION,
    },
    urlCallback: async (url) => {
      // Open the GitHub authorization page in the default browser.
      await invoke("open_external_link", { href: url });
    },
  });

  try {
    const authData = await withTimeout(
      flow,
      OAUTH_TIMEOUT_MS,
      "GitHub sign-in timed out. Please try again."
    );
    // Bring the app window to the front so the user returns to Vox.
    await getCurrentWindow().setFocus().catch(() => {});
    // Keep analytics fields fresh for returning users too (createData only
    // applies to brand-new accounts).
    await syncAnalyticsFields(authData.record.id);
    return authData.record;
  } catch (error) {
    pb.cancelRequest(requestKey);
    throw error;
  }
}

/** Sign out locally (PocketBase has no server-side session to revoke). */
export function signOut(): void {
  getPocketBase().authStore.clear();
}

/**
 * Best-effort sync of the analytics fields on the user's own record. Fails
 * silently so analytics can never block the sign-in or launch flow.
 */
async function syncAnalyticsFields(recordId: string): Promise<void> {
  try {
    await getPocketBase().collection("users").update(recordId, {
      app_name: APP_NAME,
      app_version: APP_VERSION,
    });
  } catch {
    // Non-critical — analytics fields are best-effort.
  }
}
