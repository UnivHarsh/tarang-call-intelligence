// Deterministic helpers. The corpus must be byte-identical on every machine,
// so nothing here may touch Math.random or the wall clock.

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const pickN = (rng, arr, n) => {
  const c = [...arr];
  const out = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(rng() * c.length), 1)[0]);
  return out;
};
export const chance = (rng, p) => rng() < p;
export const intBetween = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
export const round2 = (n) => Math.round(n * 100) / 100;
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export const CITIES = [
  { name: "Bengaluru", weight: 22 },
  { name: "Mumbai", weight: 20 },
  { name: "Delhi NCR", weight: 18 },
  { name: "Hyderabad", weight: 12 },
  { name: "Pune", weight: 9 },
  { name: "Chennai", weight: 7 },
  { name: "Ahmedabad", weight: 5 },
  { name: "Jaipur", weight: 4 },
  { name: "Lucknow", weight: 3 },
];

export const FIRST_NAMES = [
  "Rohit", "Sneha", "Imran", "Kavya", "Arjun", "Meera", "Vikas", "Priya",
  "Sandeep", "Ritu", "Farhan", "Ananya", "Manish", "Divya", "Rakesh", "Neha",
  "Suresh", "Pooja", "Anil", "Shreya", "Deepak", "Nisha", "Karthik", "Swati",
  "Abhishek", "Tanvi", "Gaurav", "Lakshmi", "Naveen", "Ishita", "Vivek", "Aarti",
];

export const LAST_NAMES = [
  "Sharma", "Patel", "Reddy", "Nair", "Iyer", "Khan", "Verma", "Gupta",
  "Joshi", "Mehta", "Rao", "Das", "Bose", "Kulkarni", "Chauhan", "Menon",
];

/** Fictional competitors — deliberately not real brands. */
export const COMPETITORS = ["QuickCart", "Zipp Basket", "DailyBazaar", "Nuvo Fresh"];

export const CATALOG = {
  Grocery: [
    "Aashirvaad Select Atta 5kg", "Amul Ghee 1L tin", "Tata Salt 1kg",
    "Fortune Sunflower Oil 5L", "Daawat Basmati Rice 5kg", "Toor Dal 2kg",
    "Kissan Mixed Fruit Jam 700g", "Maggi Masala 12-pack",
  ],
  Dairy: [
    "Amul Butter 500g", "Nandini Curd 1kg", "Mother Dairy Paneer 400g",
    "Amul Taaza Milk 1L x6", "Epigamia Greek Yogurt 4-pack",
  ],
  Chocolate: ["Cadbury Silk 150g x3", "Ferrero Rocher 16-pc", "Amul Dark 75% 150g"],
  Personal: [
    "Dove Shampoo 650ml", "Colgate Strong Teeth 500g", "Nivea Body Lotion 400ml",
    "Gillette Mach3 cartridges", "Whisper Ultra 30-pack",
  ],
  Home: [
    "Surf Excel Matic 4kg", "Harpic Power Plus 1L", "Vim Dishwash Bar 6-pack",
    "Milton Thermosteel 1L", "Cello Storage Set 12-pc",
  ],
  Beverages: ["Tata Tea Gold 1kg", "Nescafe Classic 200g", "Real Fruit Juice 1L x4"],
  Baby: ["Pampers Pants XL 62", "Cerelac Wheat Apple 300g", "Johnson Baby Wash 500ml"],
};

export const CATEGORY_KEYS = Object.keys(CATALOG);

/** Items that are physically fragile — used by the damaged-in-transit scenarios. */
export const FRAGILE = [
  "Fortune Sunflower Oil 5L", "Amul Ghee 1L tin", "Harpic Power Plus 1L",
  "Real Fruit Juice 1L x4", "Kissan Mixed Fruit Jam 700g", "Dove Shampoo 650ml",
];

/** Items that die without a cold chain. */
export const COLD_CHAIN = [
  "Amul Butter 500g", "Cadbury Silk 150g x3", "Mother Dairy Paneer 400g",
  "Nandini Curd 1kg", "Epigamia Greek Yogurt 4-pack", "Amul Ghee 1L tin",
  "Ferrero Rocher 16-pc",
];

export const MOODS = ["calm", "annoyed", "angry", "warm"];

/** Filler noises real transcripts are full of and clean demos never have. */
export const BACKCHANNEL = ["Hmm.", "Haan.", "Achha.", "Okay okay.", "Ji.", "Theek hai."];

export function weightedCity(rng, bias) {
  const pool = CITIES.map((c) => ({
    ...c,
    weight: c.weight * ((bias && bias[c.name]) || 1),
  }));
  const total = pool.reduce((s, c) => s + c.weight, 0);
  let r = rng() * total;
  for (const c of pool) {
    r -= c.weight;
    if (r <= 0) return c.name;
  }
  return pool[0].name;
}

/**
 * ASR confidence model. Digits, code-mixing and long turns are exactly where
 * real speech-to-text degrades, so the seeded numbers degrade there too —
 * otherwise the "low-confidence turns" affordance in the UI would be fiction.
 */
export function confFor(rng, text) {
  let base = 0.94 + rng() * 0.05;
  if (/\d/.test(text)) base -= 0.06 + rng() * 0.05;
  if (text.length > 120) base -= 0.03;
  const hinglishHits = (text.match(/\b(nahi|kya|hai|karo|mera|aapka|bhai|abhi|matlab|thoda)\b/gi) || []).length;
  base -= Math.min(0.08, hinglishHits * 0.012);
  return round2(clamp(base, 0.55, 0.99));
}

/** Build a transcript with plausible turn timing. */
export function timeline(rng, rawTurns) {
  let t = 0;
  return rawTurns
    .filter((x) => x && x.text && x.text.trim())
    .map((x) => {
      const words = x.text.trim().split(/\s+/).length;
      // ~2.05 words/sec is a realistic Indian call-centre pace once you count
      // the hesitations that transcripts flatten out.
      const speakMs = Math.round((words / 1.78) * 1000) + intBetween(rng, 900, 2600);
      const turn = { role: x.role, text: x.text.trim(), tMs: t, conf: confFor(rng, x.text) };
      // Inter-turn gap: hold music, system lookups, and people talking over each other.
      t += speakMs + intBetween(rng, 900, 4200);
      return turn;
    });
}
