import { defineConfig, loadEnv } from 'vite';
import { resolve, extname } from 'path';

const mapsRewritePlugin = () => ({
  name: 'maps-rewrite',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (shouldRewriteToMaps(req?.url)) {
        req.url = '/maps/index.html';
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (shouldRewriteToMaps(req?.url)) {
        req.url = '/maps/index.html';
      }
      next();
    });
  }
});

function shouldRewriteToMaps(url?: string) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  if (!pathname.startsWith('/maps')) return false;
  if (pathname.startsWith('/@') || pathname.startsWith('/src') || pathname.startsWith('/node_modules')) return false;
  const hasExt = Boolean(extname(pathname));
  return !hasExt;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY_TARGET || 'http://localhost:3019';
  const host = env.VITE_SERVER_HOST || 'localhost';

  return {
    plugins: [mapsRewritePlugin()],
    server: {
      host: '0.0.0.0',
      port: 80,
      allowedHosts: [host],
      hmr: {
        host: host,
        clientPort: 80
      },
      proxy: {
        '/api': {
          target: target,
          changeOrigin: true
        },
        '/uploads': {
          target: target,
          changeOrigin: true
        }
      }
    },
    appType: 'mpa',
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          maps: resolve(__dirname, 'maps/index.html')
        }
      }
    }
  };
});
