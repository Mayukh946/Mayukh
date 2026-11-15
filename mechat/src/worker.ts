import apiHandler, { setWorkerEnvironment } from '../netlify/functions/api.mts';

interface Env {
  APPWRITE_API_KEY?: string;
  appwrite_apikey?: string;
  TURN_URL?: string;
  TURN_SHARED_SECRET?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      // These bindings are stable for this Worker deployment. The API module
      // keeps its existing route/auth/Appwrite logic and reads these values.
      setWorkerEnvironment({
        APPWRITE_API_KEY: env.APPWRITE_API_KEY ?? env.appwrite_apikey,
        TURN_URL: env.TURN_URL,
        TURN_SHARED_SECRET: env.TURN_SHARED_SECRET,
      });
      return apiHandler(request);
    }

    return env.ASSETS.fetch(request);
  },
};
