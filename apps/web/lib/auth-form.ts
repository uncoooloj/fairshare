/** Normalize identity fields only. Password whitespace is meaningful. */
export function prepareAuthForm(login: boolean, raw: Record<string, string>) {
  const data: Record<string, string> = {
    ...raw,
    email: raw.email?.trim() ?? "",
  };
  if (!login) data.name = raw.name?.trim() ?? "";
  const error =
    !login && !data.name
      ? "Enter your full name."
      : data.email.length > 254
        ? "Use an email address with at most 254 characters."
        : (data.password?.length ?? 0) > 256
          ? "Use a password with at most 256 characters."
          : "";
  return { data, error };
}
