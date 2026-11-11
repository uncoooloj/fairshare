export type OnboardingStage = "welcome" | "details" | "agreement" | "complete";

function isOnboardingStage(value: string | null): value is OnboardingStage {
  return (
    value === "welcome" ||
    value === "details" ||
    value === "agreement" ||
    value === "complete"
  );
}

export function onboardingStorageKey(userId: string) {
  return `fairshare:onboarding:v1:${userId}`;
}

export function browserSessionStorage() {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function readOnboardingStage(
  storage: Pick<Storage, "getItem"> | undefined,
  fallback: Map<string, OnboardingStage>,
  userId: string,
) {
  try {
    const saved = storage?.getItem(onboardingStorageKey(userId)) ?? null;
    return isOnboardingStage(saved) ? saved : (fallback.get(userId) ?? null);
  } catch {
    return fallback.get(userId) ?? null;
  }
}

export function writeOnboardingStage(
  storage: Pick<Storage, "setItem"> | undefined,
  fallback: Map<string, OnboardingStage>,
  userId: string,
  stage: OnboardingStage,
) {
  fallback.set(userId, stage);
  try {
    storage?.setItem(onboardingStorageKey(userId), stage);
  } catch {
    // Storage may be blocked by browser privacy settings. The in-memory value
    // still preserves this tab's onboarding transition.
  }
}
