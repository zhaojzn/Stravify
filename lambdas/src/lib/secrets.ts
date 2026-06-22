import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});
const cache = new Map<string, { value: unknown; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function getJsonSecret<T>(paramName: string): Promise<T> {
  const cached = cache.get(paramName);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const r = await ssm.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }));
  if (!r.Parameter?.Value) throw new Error(`Empty parameter: ${paramName}`);
  const value = JSON.parse(r.Parameter.Value) as T;
  cache.set(paramName, { value, expiresAt: Date.now() + TTL_MS });
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

export const getStravaSecret = () => getJsonSecret<StravaSecret>(process.env.STRAVA_PARAM_NAME!);
export const getSpotifySecret = () => getJsonSecret<SpotifySecret>(process.env.SPOTIFY_PARAM_NAME!);
