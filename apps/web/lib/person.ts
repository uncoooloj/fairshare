/** Presentation-only identity helpers. Colours never encode status or money. */
export const PERSON_TONES = 6;

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable tone for a person with no agreement context, such as the signed-in user. */
export function toneForId(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % PERSON_TONES;
}

/**
 * A person keeps their own tone (the same one the sidebar shows) unless someone earlier
 * in the roster already has it; then they take the next free tone, so up to six
 * people in one agreement never share a colour.
 */
export function toneInRoster(userId: string, roster: { userId: string }[]) {
  const taken = new Set<number>();
  for (const member of roster) {
    let tone = toneForId(member.userId);
    if (taken.size < PERSON_TONES)
      while (taken.has(tone)) tone = (tone + 1) % PERSON_TONES;
    if (member.userId === userId) return tone;
    taken.add(tone);
  }
  return toneForId(userId);
}
