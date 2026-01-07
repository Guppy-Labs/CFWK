const API_URL = import.meta.env.VITE_API_URL || '';
const WS_URL = import.meta.env.VITE_WS_URL;

if (!WS_URL) {
    console.error('VITE_WS_URL is not defined in environment variables');
}

export const Config = {
    API_URL,
    WS_URL: WS_URL || 'ws://localhost:3019', // Fallback for local dev safety if env missing, but logically should be in env
    
    getApiUrl: (path: string) => `${API_URL}/api${path.startsWith('/') ? '' : '/'}${path}`,
    
    getImageUrl: (path: string | undefined) => {
        if (!path) return '';
        if (path.startsWith('http')) return path;
        return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
    }
};

