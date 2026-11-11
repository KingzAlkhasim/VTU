import crypto from 'node:crypto';
import { IVtuProvider, VtuTopupRequest, VtuTopupResponse, VtuStatusQueryResponse } from './provider.interface.js';
import { config } from '../config.js';

export class MockVtuProvider implements IVtuProvider {
  public readonly name = 'mock';
  private readonly outcomes = new Map<string, VtuStatusQueryResponse>();
  private readonly simulateFailurePhones = new Set(['08000000000', '07000000000']);
  private readonly simulatePendingPhones = new Set(['08099999999']);

  private assertSandbox(): void {
    if (config.APP_ENV !== 'sandbox') {
      throw new Error('SECURITY VIOLATION: Mock provider is permitted only in APP_ENV=sandbox.');
    }
  }

  async topup(request: VtuTopupRequest): Promise<VtuTopupResponse> {
    this.assertSandbox();
    if (config.VTU_MOCK_SIMULATE_LATENCY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.VTU_MOCK_SIMULATE_LATENCY_MS));
    }

    const providerReference = `MOCK-${crypto.randomUUID()}`;
    let status: VtuStatusQueryResponse['status'] = 'SUCCESS';
    let message = 'Airtime/data recharge simulated successfully.';
    let rawResponse: Record<string, unknown> = { code: '000', simulated: true };

    if (this.simulateFailurePhones.has(request.recipientPhone)) {
      status = 'FAILED';
      message = 'Simulated network rejection for test phone number.';
      rawResponse = { code: 'ERR_SIMULATED', simulated: true };
    } else if (this.simulatePendingPhones.has(request.recipientPhone)) {
      status = 'PENDING';
      message = 'Simulated pending state awaiting reconciliation.';
      rawResponse = { code: 'PENDING_DELIVERY', simulated: true };
    } else if (Math.random() > config.VTU_MOCK_SUCCESS_RATE) {
      status = 'FAILED';
      message = 'Simulated provider failure.';
      rawResponse = { code: 'ERR_RANDOM_SIMULATED', simulated: true };
    }

    const outcome: VtuStatusQueryResponse = { status, providerReference, message, rawResponse };
    this.outcomes.set(providerReference, outcome);

    return {
      success: status !== 'FAILED',
      status,
      providerReference,
      message,
      rawResponse,
    };
  }

  async checkStatus(providerReference: string): Promise<VtuStatusQueryResponse> {
    this.assertSandbox();
    const outcome = this.outcomes.get(providerReference);
    if (!outcome) {
      return {
        status: 'PENDING',
        providerReference,
        message: 'Mock provider has no recorded result for this reference.',
        rawResponse: { reconciled: false, knownReference: false },
      };
    }
    return { ...outcome, rawResponse: { ...outcome.rawResponse, reconciled: true } };
  }
}
