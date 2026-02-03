import { defineConfig, loadEnv } from 'vite';
import { resolve, extname } from 'path';

const mapsRewritePlugin = () => ({
  name: 'maps-rewrite',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (shouldRewriteToMaps(req?.url)) {
        req.url = '/maps/index.html';
      } else if (shouldRewriteToLogin(req?.url)) {
        req.url = '/login/index.html';
      } else if (shouldRewriteToOnboarding(req?.url)) {
        req.url = '/onboarding/index.html';
      } else if (shouldRewriteToAccount(req?.url)) {
        req.url = '/account/index.html';
      } else if (shouldRewriteToSoon(req?.url)) {
        req.url = '/soon.html';
      } else if (shouldRewriteToVerify(req?.url)) {
        req.url = '/verify/index.html';
      } else if (shouldRewriteToReset(req?.url)) {
        req.url = '/reset/index.html';
      } else if (shouldRewriteToSent(req?.url)) {
        req.url = '/sent/index.html';
      } else if (shouldRewriteToForgot(req?.url)) {
        req.url = '/forgot/index.html';
      } else if (shouldRewriteToGame(req?.url)) {
        req.url = '/game/index.html';
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (shouldRewriteToMaps(req?.url)) {
        req.url = '/maps/index.html';
      } else if (shouldRewriteToLogin(req?.url)) {
        req.url = '/login/index.html';
      } else if (shouldRewriteToOnboarding(req?.url)) {
        req.url = '/onboarding/index.html';
      } else if (shouldRewriteToAccount(req?.url)) {
        req.url = '/account/index.html';
      } else if (shouldRewriteToSoon(req?.url)) {
        req.url = '/soon.html';
      } else if (shouldRewriteToVerify(req?.url)) {
        req.url = '/verify/index.html';
      } else if (shouldRewriteToReset(req?.url)) {
        req.url = '/reset/index.html';
      } else if (shouldRewriteToSent(req?.url)) {
        req.url = '/sent/index.html';
      } else if (shouldRewriteToForgot(req?.url)) {
        req.url = '/forgot/index.html';
      } else if (shouldRewriteToGame(req?.url)) {
        req.url = '/game/index.html';
      }
      next();
    });
  }
});

function shouldRewriteToGame(url?: string) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  // Support both /game and /play
  if (pathname === '/game' || pathname === '/game/' || pathname === '/play' || pathname === '/play/') return true;
  return false;
}

function shouldRewriteToLogin(url?: string) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  if (pathname === '/login' || pathname === '/login/' || pathname === '/register' || pathname === '/register/') return true;
  return false;
}

function shouldRewriteToOnboarding(url?: string) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  if (pathname === '/onboarding' || pathname === '/onboarding/') return true;
  return false;
}

function shouldRewriteToAccount(url?: string) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  if (pathname === '/account' || pathname === '/account/') return true;
  return false;
}

function shouldRewriteToSoon(url?: string) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  if (pathname === '/soon' || pathname === '/soon/') return true;
  return false;
}

function shouldRewriteToVerify(url?: string) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  if (pathname === '/verify' || pathname === '/verify/') return true;
  return false;
}

function shouldRewriteToReset(url?: string) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  if (pathname === '/reset' || pathname === '/reset/') return true;
  return false;
}

function shouldRewriteToSent(url?: string) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  if (pathname === '/sent' || pathname === '/sent/') return true;
  return false;
}

function shouldRewriteToForgot(url?: string) {
  if (!url) return false;
  const pathname = url.split('?')[0];
  if (pathname === '/forgot' || pathname === '/forgot/') return true;
  return false;
}

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
  const allowedHosts = (env.VITE_SERVER_HOSTS || host)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const hmrConfig = host !== 'localhost' ? {
      host: allowedHosts[0] || host,
      clientPort: 443,
      overlay: false
  } : undefined;

  return {
    plugins: [mapsRewritePlugin()],
    server: {
      host: '0.0.0.0',
      port: 81,
      allowedHosts: allowedHosts,
      hmr: hmrConfig,
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
          game: resolve(__dirname, 'game/index.html'),
          maps: resolve(__dirname, 'maps/index.html'),
          onboarding: resolve(__dirname, 'onboarding/index.html'),
          account: resolve(__dirname, 'account/index.html'),
          login: resolve(__dirname, 'login/index.html'),
          verify: resolve(__dirname, 'verify/index.html'),
          reset: resolve(__dirname, 'reset/index.html'),
          sent: resolve(__dirname, 'sent/index.html'),
          forgot: resolve(__dirname, 'forgot/index.html'),
          soon: resolve(__dirname, 'soon.html')
        }
      }
    }
  };
});
