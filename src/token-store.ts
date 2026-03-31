import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
}

/**
 * Persists HelpScout OAuth tokens to a JSON file in the plugin's state directory.
 * On first boot, bootstraps from environment variables. After each refresh,
 * writes the new tokens to disk so they survive gateway restarts.
 */
export class TokenStore {
  private filePath: string;
  private cached: StoredTokens | null = null;
  private refreshMutex: Promise<void> | null = null;

  constructor(
    stateDir: string,
    private env: {
      clientId: string;
      clientSecret: string;
      accessToken: string;
      refreshToken: string;
    },
  ) {
    mkdirSync(stateDir, { recursive: true });
    this.filePath = join(stateDir, "helpscout-tokens.json");
  }

  /**
   * Get current tokens. Reads from file first, falls back to env vars.
   */
  getTokens(): StoredTokens {
    if (this.cached) return this.cached;

    // Try reading from file
    if (existsSync(this.filePath)) {
      try {
        const data = JSON.parse(readFileSync(this.filePath, "utf-8"));
        this.cached = data as StoredTokens;
        return this.cached;
      } catch {
        // File corrupted, fall through to env bootstrap
      }
    }

    // Bootstrap from env vars
    this.cached = {
      accessToken: this.env.accessToken,
      refreshToken: this.env.refreshToken,
      expiresAt: null, // Unknown expiry for bootstrap tokens
    };
    return this.cached;
  }

  /**
   * Check if the current access token is expired.
   */
  isExpired(): boolean {
    const tokens = this.getTokens();
    if (!tokens.expiresAt) return false; // Can't tell — try using it
    return new Date(tokens.expiresAt) < new Date();
  }

  /**
   * Refresh the access token. Uses a mutex to prevent concurrent refreshes
   * from invalidating single-use refresh tokens.
   */
  async refresh(logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void }): Promise<string> {
    // Mutex: if a refresh is already in progress, wait for it
    if (this.refreshMutex) {
      await this.refreshMutex;
      return this.getTokens().accessToken;
    }

    let resolve: () => void;
    this.refreshMutex = new Promise<void>((r) => { resolve = r; });

    try {
      const tokens = this.getTokens();
      logger.info("[helpscout] Refreshing access token");

      const response = await fetch("https://api.helpscout.net/v2/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: this.env.clientId,
          client_secret: this.env.clientSecret,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("[helpscout] Token refresh failed", {
          status: response.status,
          body: errorText,
        });
        throw new Error("Failed to refresh HelpScout access token");
      }

      const data = await response.json();
      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null;

      this.cached = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? tokens.refreshToken,
        expiresAt,
      };

      // Persist to disk
      writeFileSync(this.filePath, JSON.stringify(this.cached, null, 2));
      logger.info("[helpscout] Token refreshed and persisted");

      return this.cached.accessToken;
    } finally {
      this.refreshMutex = null;
      resolve!();
    }
  }

  /**
   * Force-clear the cached token so the next call triggers a refresh.
   */
  invalidate(): void {
    this.cached = this.cached
      ? { ...this.cached, expiresAt: new Date(0).toISOString() }
      : null;
  }
}
