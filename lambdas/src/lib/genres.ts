// Normalize Last.fm / Spotify tag strings into a smaller canonical set,
// and bucket long tails into "other".

const SYNONYMS: Record<string, string[]> = {
  "k-pop":              ["kpop", "k pop", "korean", "korean pop", "k-pop", "korean indie"],
  "j-pop":              ["jpop", "j pop", "japanese pop", "japanese", "j-pop"],
  "c-pop":              ["cpop", "c pop", "chinese", "mandopop", "mandarin pop"],
  "hip-hop":            ["hiphop", "hip hop", "hip-hop"],
  "rap":                ["rap music", "trap"],
  "r&b":                ["rnb", "r n b", "r and b", "r&b", "rhythm and blues", "contemporary r&b"],
  "lo-fi":              ["lofi", "lo fi", "lo-fi", "lofi hip hop", "lofi hip-hop"],
  "electronic":         ["edm", "electronica", "electro", "electronic dance", "dance"],
  "house":              ["house music", "deep house", "tech house"],
  "techno":             ["techno music"],
  "drum and bass":      ["dnb", "d&b", "drum n bass", "drum'n'bass"],
  "rock":               ["rock music", "rock and roll", "rock n roll"],
  "indie rock":         ["indie-rock"],
  "alternative":        ["alternative rock", "alt rock", "alt-rock", "alternative-rock"],
  "indie":              ["indie music", "indie pop"],
  "metal":              ["heavy metal", "metalcore"],
  "punk":               ["punk rock"],
  "pop":                ["pop music"],
  "country":            ["country music", "country-pop"],
  "folk":               ["folk music", "indie folk"],
  "jazz":               ["jazz music", "smooth jazz"],
  "soul":               ["neo soul", "neo-soul"],
  "classical":          ["classical music", "orchestral"],
  "latin":              ["latin music", "reggaeton", "latin pop"],
  "ambient":            ["ambient music", "downtempo"],
};

function buildReverseMap() {
  const map = new Map<string, string>();
  for (const [canonical, variants] of Object.entries(SYNONYMS)) {
    map.set(canonical, canonical);
    for (const v of variants) map.set(v, canonical);
  }
  return map;
}
const REVERSE = buildReverseMap();

/** Light cleanup that doesn't change meaning. */
function clean(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizeTag(raw: string): string {
  const c = clean(raw);
  if (REVERSE.has(c)) return REVERSE.get(c)!;
  // Try a punctuation-stripped form for things like "k-pop" -> "kpop"
  const stripped = c.replace(/[-\s]/g, "");
  if (REVERSE.has(stripped)) return REVERSE.get(stripped)!;
  return c;
}

export interface BreakdownItem { genre: string; trackCount: number; percent: number }

/** Cap genres to top N; collapse the rest into "other". */
export function bucket(items: BreakdownItem[], max = 8): BreakdownItem[] {
  if (items.length <= max) return items;
  const head = items.slice(0, max);
  const tail = items.slice(max);
  const otherCount = tail.reduce((a, b) => a + b.trackCount, 0);
  const otherPct = tail.reduce((a, b) => a + b.percent, 0);
  if (otherCount === 0) return head;
  return [...head, { genre: "other", trackCount: otherCount, percent: otherPct }];
}
