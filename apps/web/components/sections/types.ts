/** Runs an action with the app's shared busy, error and notice handling. */
export type Run = (fn: () => Promise<void>) => Promise<void>;
/** Posts an agreement action with the expected revision, then reloads. */
export type Mutate = (
  action: string,
  extra?: Record<string, unknown>,
  method?: "POST" | "DELETE",
) => Promise<void>;
