import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const local = (path) => fileURLToPath(new URL(path, import.meta.url));
await build({
  entryPoints: [local("./worker.ts")],
  outfile: local("../dist-cloudflare/worker.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: ["cloudflare:workers"],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire('/worker.js');",
  },
  plugins: [
    {
      name: "worker-runtime",
      setup(builder) {
        builder.onResolve(
          { filter: /^@fairshare\/(domain|payments|contract-ai)$/ },
          (args) => ({
            path: local(
              "../../../packages/" + args.path.split("/")[1] + "/src/index.ts",
            ),
          }),
        );
        builder.onResolve({ filter: /^fastify$/ }, () => ({
          path: local("./router.ts"),
        }));
        builder.onResolve({ filter: /nodeDatabase\.js$/ }, () => ({
          path: local("./nodeDatabase.ts"),
        }));
      },
    },
  ],
});
