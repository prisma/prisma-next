/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Prisma Next Mongo runtime depends on `mongodb`, a Node-native driver
  // that doesn't play nicely with Next.js's bundler. Keeping it external
  // ensures it's loaded from node_modules at runtime on the server.
  serverExternalPackages: ['mongodb', '@prisma-next/mongo-runtime', '@prisma-next/driver-mongo'],
};

export default nextConfig;
