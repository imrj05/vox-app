/**
 * Correction-pair extraction for the Vocabulary Packs learner (spec §17):
 * position-aligned word diffs between a raw transcript and the user's edit.
 */

/** Common English words that should never be auto-learned. */
const COMMON_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "so", "for", "with",
  "without", "from", "to", "at", "by", "on", "in", "of", "is", "are", "was",
  "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "can", "could", "should", "may", "might", "must", "i",
  "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "this", "that", "these",
  "those", "not", "no", "yes", "all", "any", "each", "every", "some", "more",
  "most", "other", "such", "only", "own", "same", "too", "very", "just",
  "also", "into", "over", "under", "again", "further", "once", "here",
  "there", "when", "where", "why", "how", "what", "which", "who", "whom",
  "about", "above", "below", "between", "during", "before", "after", "up",
  "down", "out", "off", "than", "then", "now", "get", "got", "make", "made",
  "like", "want", "need", "use", "used", "say", "said", "see", "saw", "go",
  "went", "come", "came", "know", "knew", "think", "thought", "take", "took",
  "give", "gave", "find", "found", "tell", "told", "work", "worked", "call",
  "called", "try", "tried", "ask", "asked", "seem", "seemed", "feel", "felt",
  "become", "became", "leave", "left", "put", "set", "let", "keep", "kept",
  "start", "started", "end", "ended", "show", "showed", "hear", "heard",
  "play", "played", "run", "ran", "move", "moved", "live", "lived", "believe",
  "believed", "bring", "brought", "happen", "happened", "write", "wrote",
  "provide", "provided", "sit", "sat", "stand", "stood", "lose", "lost",
  "pay", "paid", "meet", "met", "include", "included", "continue", "continued",
  "set", "learn", "learned", "change", "changed", "lead", "led", "understand",
  "understood", "watch", "watched", "follow", "followed", "stop", "stopped",
  "create", "created", "speak", "spoke", "read", "read", "allow", "allowed",
  "add", "added", "spend", "spent", "grow", "grew", "open", "opened", "walk",
  "walked", "win", "won", "offer", "offered", "remember", "remembered", "love",
  "loved", "consider", "considered", "appear", "appeared", "buy", "bought",
  "wait", "waited", "serve", "served", "die", "died", "send", "sent", "expect",
  "expected", "build", "built", "stay", "stayed", "fall", "fell", "cut",
  "reach", "reached", "kill", "killed", "raise", "raised", "pass", "passed",
  "sell", "sold", "decide", "decided", "return", "returned", "explain",
  "explained", "hope", "hoped", "develop", "developed", "carry", "carried",
  "break", "broke", "receive", "received", "agree", "agreed", "support",
  "supported", "hit", "produce", "produced", "eat", "ate", "cover", "covered",
  "catch", "caught", "draw", "drew", "choose", "chose", "please", "thank",
  "thanks", "hello", "hi", "okay", "ok", "yeah", "sure", "right", "good",
  "great", "nice", "fine", "well", "really", "actually", "basically", "maybe",
  "perhaps", "probably", "definitely", "certainly", "always", "never", "often",
  "sometimes", "usually", "today", "tomorrow", "yesterday", "now", "later",
  "soon", "early", "late", "first", "second", "third", "last", "next", "new",
  "old", "big", "small", "large", "little", "high", "low", "long", "short",
  "fast", "slow", "easy", "hard", "simple", "complex", "important", "different",
  "same", "other", "another", "many", "much", "few", "several", "number",
  "part", "place", "point", "thing", "way", "time", "day", "week", "month",
  "year", "hour", "minute", "second", "person", "people", "man", "woman",
  "child", "children", "friend", "family", "home", "work", "school", "city",
  "country", "world", "life", "hand", "eye", "face", "head", "heart", "body",
  "water", "food", "money", "book", "word", "line", "page", "question",
  "answer", "problem", "solution", "idea", "plan", "goal", "team", "project",
  "meeting", "email", "message", "phone", "computer", "internet", "website",
  "app", "application", "software", "hardware", "system", "data", "file",
  "folder", "document", "report", "information", "company", "business",
  "customer", "client", "service", "product", "price", "cost", "value",
  "quality", "level", "type", "kind", "form", "group", "member", "number",
  "name", "title", "date", "time", "place", "event", "issue", "matter",
  "case", "fact", "example", "result", "reason", "cause", "effect", "change",
  "process", "method", "step", "stage", "phase", "section", "part", "piece",
  "bit", "lot", "bit", "sort", "kind", "type", "way", "means", "end", "start",
  "beginning", "middle", "top", "bottom", "side", "front", "back", "left",
  "right", "center", "middle", "inside", "outside", "around", "through",
  "across", "along", "toward", "towards", "onto", "upon", "within", "without",
  "except", "besides", "including", "among", "amongst", "despite", "although",
  "though", "while", "whereas", "unless", "until", "since", "because", "as",
  "if", "whether", "either", "neither", "both", "each", "every", "all",
  "whole", "entire", "total", "complete", "full", "empty", "single", "double",
  "triple", "half", "quarter", "third", "fourth", "fifth", "sixth", "seventh",
  "eighth", "ninth", "tenth", "hundred", "thousand", "million", "billion",
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty",
  "fifty", "sixty", "seventy", "eighty", "ninety", "am", "pm", "etc", "eg",
  "ie", "vs", "via", "per", "pro", "con", "pre", "post", "non", "sub", "sup",
  "de", "la", "le", "les", "un", "une", "des", "du", "au", "aux", "en", "el",
  "los", "las", "del", "al", "das", "der", "die", "und", "mit", "von", "zu",
  "im", "am", "auf", "für", "für", "ist", "sind", "nicht", "aap", "hai",
  "hain", "hai", "ka", "ki", "ke", "ko", "mein", "mera", "meri", "tere",
  "tera", "teri", "hum", "tum", "wo", "ye", "aur", "nahi", "haan", "theek",
  "thik", "acha", "accha", "bahut", "zyada", "kam", "abhi", "kal", "aaj",
  "yahan", "wahan", "kya", "kyun", "kaise", "kab", "kahan", "kaun", "kis",
  "kisne", "kisko", "kuch", "koi", "sab", "saare", "ek", "do", "teen", "char",
  "paanch", "chhe", "saat", "aath", "nau", "das", "gaya", "gayi", "gaye",
  "kiya", "kiye", "kari", "kare", "karo", "karna", "karte", "karta", "karti",
  "hoga", "hogi", "honge", "tha", "thi", "the", "ho", "hain", "hai", "raha",
  "rahi", "rahe", "raho", "rahen", "chahiye", "sakta", "sakti", "sakte",
  "sakta", "sakti", "sakte", "de", "do", "deta", "deti", "dete", "le", "lo",
  "leta", "leti", "lete", "ja", "jao", "jata", "jati", "jate", "aaya", "aayi",
  "aaye", "aana", "aate", "aati", "aata", "bol", "bolo", "bolta", "bolti",
  "bolte", "dekho", "dekha", "dekhi", "dekhe", "sun", "suno", "suna", "suni",
  "sune", "kar", "karo", "karta", "karti", "karte", "karna", "karke", "karke",
  "hoke", "hokar", "ban", "bano", "banta", "banti", "bante", "bana", "bani",
  "bane", "rakh", "rakho", "rakhta", "rakhti", "rakhte", "rakha", "rakhi",
  "rakhe", "dekh", "dekho", "dekhta", "dekhti", "dekhte", "dekha", "dekhi",
  "dekhe", "mil", "milo", "milta", "milti", "milte", "mila", "mili", "mile",
  "chahiye", "chahie", "chahiye", "hona", "hone", "hota", "hoti", "hote",
  "hoga", "hogi", "honge", "tha", "thi", "the", "hai", "hain", "ho", "hum",
  "tum", "aap", "main", "mein", "mujhe", "tujhe", "usko", "isko", "inhe",
  "unhe", "in", "un", "is", "us", "ye", "wo", "voh", "aur", "lekin", "par",
  "magar", "kya", "kyun", "kaise", "kab", "kahan", "kaun", "kis", "kisne",
  "kisko", "kuch", "koi", "sab", "saare", "bahut", "zyada", "kam", "thoda",
  "thodi", "thode", "abhi", "ab", "phir", "fir", "tab", "jab", "jabse",
  "jabtak", "jabki", "jab", "agar", "toh", "to", "bhi", "hi", "he", "hain",
  "nahi", "na", "mat", "matt", "haan", "ha", "ji", "jii", "namaste",
  "namaskar", "dhanyavad", "shukriya", "please", "sorry", "excuse", "welcome",
]);

/** Words that appear in the corrected text but not the original, filtered to
 * meaningful, learnable terms (technical words, names, product names). */
/**
 * Position-aligned (source → canonical) correction pairs for the Vocabulary
 * Packs learner (spec §17). Only pairs where the corrected word is learnable
 * are returned; ordering follows the corrected text.
 */
export function correctionPairs(
  original: string,
  corrected: string
): Array<{ source: string; canonical: string }> {
  const originalWords = tokenize(original);
  const correctedWords = tokenize(corrected);
  const pairs: Array<{ source: string; canonical: string }> = [];
  const seen = new Set<string>();
  const length = Math.min(originalWords.length, correctedWords.length);
  for (let i = 0; i < length; i++) {
    const before = originalWords[i];
    const after = correctedWords[i];
    if (before === after) continue;
    if (!isLearnable(after) || !isLearnable(before)) continue;
    const key = `${before}\u0000${after}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ source: before, canonical: after });
  }
  return pairs;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;:!?()"'`]+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

function isLearnable(word: string): boolean {
  if (word.length < 3 || word.length > 40) return false;
  if (!/[a-z]/.test(word)) return false;
  if (COMMON_WORDS.has(word)) return false;
  return true;
}
