/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Prisma Next postgres runtime depends on `pg`, which is a Node-native
  // module that doesn't play nicely with Next.js's bundler. Keeping it external
  // ensures it's loaded from node_modules at runtime on the server.
  serverExternalPackages: ['pg', '@prisma-next/postgres', '@prisma-next/driver-postgres'],
};

export default nextConfig;
