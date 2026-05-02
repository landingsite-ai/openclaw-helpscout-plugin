import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface StoredToken {
  accessToken: string;
  expiresAt: string;
}

interface Logger {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Fetches HelpScout access tokens via the client_credentials OAuth grant.
 * Caches the access token (and expiry) on disk so the gateway doesn't hit
 * the token endpoint on every restart. When expired or invalidated, runs
 * the grant again to mint a fresh token — no refresh token to track.
 */
export class TokenStore {
  private filePath: string;
  private cached: StoredToken | null = null;
  private fetchMutex: Promise<void> | null = null;

  constructor(
    stateDir: string,
    private env: { clientId: string; clientSecret: string },
  ) {
    mkdirSync(stateDir, { recursive: true });
    this.filePath = join(stateDir, "helpscout-token.json");
  }

  /**
   * Return a valid access token, fetching a new one if the cache is empty
   * or expired.
   */
  async getAccessToken(logger: Logger): Promise<string> {
    const cached = this.readCache();
    if (cached && new Date(cached.expiresAt) > new Date()) {
      return cached.accessToken;
    }
    return this.fetchNewToken(logger);
  }

  /**
   * Force-clear the cache so the next call mints a fresh token.
   * Used when an API request returns 401 mid-flight.
   */
  invalidate(): void {
    this.cached = null;
  }

  private readCache(): StoredToken | null {
    if (this.cached) return this.cached;
    if (!existsSync(this.filePath)) return null;
    try {
      this.cached = JSON.parse(readFileSync(this.filePath, "utf-8")) as StoredToken;
      return this.cached;
    } catch {
      return null;
    }
  }

  private async fetchNewToken(logger: Logger): Promise<string> {
    if (this.fetchMutex) {
      await this.fetchMutex;
      const cached = this.readCache();
      if (cached && new Date(cached.expiresAt) > new Date()) {
        return cached.accessToken;
      }
    }

    let resolve: () => void;
    this.fetchMutex = new Promise<void>((r) => { resolve = r; });

    try {
      logger.info("[helpscout] Minting access token via client_credentials");

      const response = await fetch("https://api.helpscout.net/v2/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.env.clientId,
          client_secret: this.env.clientSecret,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("[helpscout] Token mint failed", {
          status: response.status,
          body: errorText,
        });
        throw new Error(`Failed to mint HelpScout access token: ${response.status}`);
      }

      const data = await response.json();
      if (!data.access_token || typeof data.expires_in !== "number") {
        throw new Error("HelpScout token response missing access_token or expires_in");
      }

      const token: StoredToken = {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      };

      this.cached = token;
      writeFileSync(this.filePath, JSON.stringify(token, null, 2));
      logger.info("[helpscout] Access token cached", { expiresAt: token.expiresAt });

      return token.accessToken;
    } finally {
      this.fetchMutex = null;
      resolve!();
    }
  }
}
