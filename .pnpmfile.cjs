/**
 * PNPM file to resolve catalog: protocol references to explicit versions.
 * This allows pnpm to install packages that use `catalog:` in package.json.
 */
const catalogVersions = {
  '@replit/vite-plugin-cartographer': '^1.0.0',
  '@replit/vite-plugin-dev-banner': '^1.0.0',
  '@replit/vite-plugin-runtime-error-modal': '^1.0.0',
  '@tailwindcss/vite': '^4.1.8',
  '@tanstack/react-query': '^5.90.5',
  '@types/node': '^22.15.29',
  '@types/react': '^19.1.4',
  '@types/react-dom': '^19.1.6',
  '@vitejs/plugin-react': '^4.6.0',
  'class-variance-authority': '^0.7.1',
  'clsx': '^2.1.1',
  'framer-motion': '^12.6.3',
  'lucide-react': '^0.511.0',
  'react': '^19.1.0',
  'react-dom': '^19.1.0',
  'tailwind-merge': '^3.3.0',
  'tailwindcss': '^4.1.8',
  'vite': '^6.3.5',
  'zod': '^3.25.76',
};

module.exports = {
  hooks: {
    readPackage(pkg, { workspacePackages }) {
      const deps = [
        ...(pkg.dependencies ? Object.entries(pkg.dependencies) : []),
        ...(pkg.devDependencies ? Object.entries(pkg.devDependencies) : []),
        ...(pkg.optionalDependencies ? Object.entries(pkg.optionalDependencies) : []),
      ];

      for (const [name, version] of deps) {
        if (version === 'catalog:' && catalogVersions[name]) {
          if (pkg.devDependencies) {
            pkg.devDependencies[name] = catalogVersions[name];
          } else if (pkg.dependencies) {
            pkg.dependencies[name] = catalogVersions[name];
          } else if (pkg.optionalDependencies) {
            pkg.optionalDependencies[name] = catalogVersions[name];
          }
        }
      }

      return pkg;
    },
  },
};
