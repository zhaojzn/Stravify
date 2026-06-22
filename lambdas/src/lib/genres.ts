// Map fine-grained Spotify / Last.fm tags into a small set of "major"
// parent categories, then pick ONE primary category per artist
// (winner-takes-all). This avoids the failure mode where one R&B artist with
// many descriptive tags ("r&b", "k-pop", "indie", "alternative", "indie rock")
// shows up as 20% across five different micro-genres.

interface CategoryRule {
  category: string;
  // Patterns are matched as substrings against the normalized tag (lowercased,
  // hyphens/underscores → spaces). Order within a category doesn't matter;
  // order across categories does — earlier categories win ties and override
  // later ones when a tag matches multiple.
  patterns: string[];
}

// "Strong" categories describe a concrete musical style. If an artist has any
// tag matching a strong category, the primary category is chosen from these.
// Order = priority for tie-breaking (earlier wins).
const STRONG_CATEGORIES: CategoryRule[] = [
  { category: "r&b",        patterns: ["r&b", "rnb", "rhythm and blues", "soul", "blues", "neo soul"] },
  { category: "hip-hop",    patterns: ["hip hop", "hiphop", "rap", "trap", "drill", "boom bap"] },
  { category: "jazz",       patterns: ["jazz", "bebop", "swing"] },
  { category: "metal",      patterns: ["metal", "metalcore", "deathcore", "djent"] },
  { category: "country",    patterns: ["country", "americana", "bluegrass"] },
  { category: "electronic", patterns: ["edm", "electronic", "electro", "electronica", "house", "techno", "dnb", "drum and bass", "drum n bass", "dubstep", "trance", "ambient", "downtempo", "garage", "synthwave", "trip hop"] },
  { category: "classical",  patterns: ["classical", "orchestral", "baroque", "opera", "choral"] },
  { category: "folk",       patterns: ["folk"] },
  { category: "latin",      patterns: ["latin", "reggaeton", "bachata", "salsa", "cumbia", "samba", "bossa nova"] },
  { category: "reggae",     patterns: ["reggae", "dancehall", "ska"] },
  { category: "k-pop",      patterns: ["k pop", "kpop", "korean"] },
  { category: "j-pop",      patterns: ["j pop", "jpop", "japanese"] },
  { category: "c-pop",      patterns: ["c pop", "cpop", "mandopop", "mandarin", "cantopop", "chinese"] },
];

// "Weak" categories are stylistic descriptors that only win when the artist
// has no strong tags at all (e.g. an indie rock band tagged only with
// ["indie", "alternative", "indie rock"]).
const WEAK_CATEGORIES: CategoryRule[] = [
  { category: "rock",  patterns: ["rock", "punk", "grunge", "emo", "hardcore", "alternative", "alt rock"] },
  { category: "pop",   patterns: ["pop"] },
  { category: "indie", patterns: ["indie"] },
  { category: "lo-fi", patterns: ["lo fi", "lofi", "chillhop"] },
];

function normalize(tag: string): string {
  return tag.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function findCategory(tag: string, rules: CategoryRule[]): string | null {
  const t = normalize(tag);
  for (const rule of rules) {
    for (const p of rule.patterns) {
      if (t.includes(p)) return rule.category;
    }
  }
  return null;
}

/** Pick one major category for an artist based on all their genre tags.
 *  Returns "uncategorized" if nothing matches. */
export function primaryCategoryForArtist(rawTags: string[]): string {
  if (rawTags.length === 0) return "uncategorized";

  const strongCounts = new Map<string, number>();
  const weakCounts = new Map<string, number>();

  for (const raw of rawTags) {
    const strong = findCategory(raw, STRONG_CATEGORIES);
    if (strong) {
      strongCounts.set(strong, (strongCounts.get(strong) || 0) + 1);
      continue;
    }
    const weak = findCategory(raw, WEAK_CATEGORIES);
    if (weak) {
      weakCounts.set(weak, (weakCounts.get(weak) || 0) + 1);
    }
  }

  const pickWinner = (counts: Map<string, number>, order: CategoryRule[]): string | null => {
    if (counts.size === 0) return null;
    const max = Math.max(...counts.values());
    // Tie-break by category order in the rules array.
    for (const rule of order) {
      if (counts.get(rule.category) === max) return rule.category;
    }
    return null;
  };

  return pickWinner(strongCounts, STRONG_CATEGORIES)
      ?? pickWinner(weakCounts, WEAK_CATEGORIES)
      ?? "uncategorized";
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
