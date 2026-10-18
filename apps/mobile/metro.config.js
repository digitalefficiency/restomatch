const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

// Enable resolution of modern ESM packages that use the `exports` field
// in package.json (e.g. copy-anything inside superjson, drizzle-orm,
// some tRPC v11 internals). Without this, Metro falls back to `main`
// which often points to non-existent paths in ESM-first packages.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
