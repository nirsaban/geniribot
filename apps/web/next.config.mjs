// Optional base path so the app can be served under a sub-path
// (e.g. https://miltech.cloud/kesher) without DNS. Empty = served at domain root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(basePath ? { basePath } : {}),
  // Workspace packages ship raw TS; let Next transpile them.
  transpilePackages: ["@kesher/core", "@kesher/db"],
  // Keep native/server deps external so they load at runtime (not webpack-bundled).
  serverExternalPackages: ["argon2", "@prisma/client", "bullmq", "ioredis"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // argon2 is pulled transitively via the transpiled @kesher/core package,
      // which slips past serverExternalPackages. Force it to a runtime require
      // so its native .node binary loads instead of being bundled by webpack.
      const externals = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      config.externals = [...externals, { argon2: "commonjs argon2" }];
    }
    return config;
  },
};

export default nextConfig;
