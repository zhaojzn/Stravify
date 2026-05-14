import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});
const cache = new Map<string, { value: unknown; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function getJsonSecret<T>(secretId: string): Promise<T> {
  const cached = cache.get(secretId);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const r = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!r.SecretString) throw new Error(`Empty secret: ${secretId}`);
  const value = JSON.parse(r.SecretString) as T;
  cache.set(secretId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export interface StravaSecret {
  clientId: string;
  clientSecret: string;
  verifyToken: string;
}
export interface SpotifySecret {
  clientId: string;
  clientSecret: string;
}

export const getStravaSecret = () => getJsonSecret<StravaSecret>(process.env.STRAVA_SECRET_ID!);
export const getSpotifySecret = () => getJsonSecret<SpotifySecret>(process.env.SPOTIFY_SECRET_ID!);
