export function AuthErrorNotice({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  if (!message) return null;
  return createElement("p", { className, role: "alert" }, message);
}
import { createElement } from "react";

