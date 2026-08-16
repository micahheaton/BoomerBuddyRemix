import type { FraudProvider, ProviderResult } from './types';

export class LocalUnknownProvider implements FraudProvider {
  async inspect(): Promise<ProviderResult> {
    return {
      status: 'unknown',
      providerName: 'local-unknown',
      providerVersion: '1',
      observations: [],
      limitation:
        'No live reputation provider is configured; no URL or external resource was contacted.',
    };
  }
}
