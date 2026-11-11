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

/** Inside an agreement, roster order guarantees distinct tones for up to six people. */
export function toneInRoster(userId: string, roster: { userId: string }[]) {
  const index = roster.findIndex((member) => member.userId === userId);
  return index < 0 ? toneForId(userId) : index % PERSON_TONES;
}
