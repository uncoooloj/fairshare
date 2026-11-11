const origin = "https://usefairshare.app";
for (const path of ["/", "/login", "/app", "/api/service/health"]) {
  const response = await fetch(origin + path, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status !== 200) {
    throw new Error(`${path}: expected 200, received ${response.status}`);
  }
  if (path.endsWith("health")) await response.json();
  console.log(`PASS ${path}`);
}
const rejected = await fetch(`${origin}/api/service/auth/login`, {
  method: "POST",
  headers: {
    origin: "https://invalid.example",
    "content-type": "application/json",
  },
  body: "{}",
  signal: AbortSignal.timeout(30000),
});
if (rejected.status !== 403) throw new Error("Cross-origin protection failed");
console.log("PASS cross-origin protection (no login or payment attempted)");
