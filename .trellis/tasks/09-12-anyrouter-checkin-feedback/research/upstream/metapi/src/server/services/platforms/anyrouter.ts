import { NewApiAdapter } from './newApi.js';

export class AnyRouterAdapter extends NewApiAdapter {
  readonly platformName = 'anyrouter';

  async detect(url: string): Promise<boolean> {
    const normalized = (url || '').toLowerCase();
    return normalized.includes('anyrouter');
  }
}
