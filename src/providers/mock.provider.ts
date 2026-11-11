import { IVtuProvider, VtuTopupRequest, VtuTopupResponse, VtuStatusQueryResponse } from './provider.interface.js';
import { config } from '../config.js';

export class MockVtuProvider implements IVtuProvider {
  public readonly name = 'mock';

  private simulateFailurePhones = new Set(['08000000000', '07000000000']);
  private simulatePendingPhones = new Set(['08099999999']);

  async topup(request: VtuTopupRequest): Promise<VtuTopupResponse> {
    if (config.APP_ENV === 'production') {
      throw new Error('SECURITY VIOLATION: Mock provider cannot be executed in production environment.');
    }

    if (config.VTU_MOCK_SIMULATE_LATENCY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.VTU_MOCK_SIMULATE_LATENCY_MS));
    }

    const providerRef = `MOCK-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // Simulate intentional test numbers
    if (this.simulateFailurePhones.has(request.recipientPhone)) {
      return {
        success: false,
        status: 'FAILED',
        providerReference: providerRef,
        message: 'Simulated network rejection on test phone number.',
        rawResponse: { code: 'ERR_SIMULATED', error: 'Network rejected' },
      };
    }

    if (this.simulatePendingPhones.has(request.recipientPhone)) {
      return {
        success: true,
        status: 'PENDING',
        providerReference: providerRef,
        message: 'Simulated pending state awaiting asynchronous delivery.',
        rawResponse: { code: 'PENDING_DELIVERY' },
      };
    }

    // Default mock response: SUCCESS
    return {
      success: true,
      status: 'SUCCESS',
      providerReference: providerRef,
      message: 'Airtime/Data recharge simulated successfully.',
      rawResponse: {
        code: '000',
        content: {
          transactions: {
            status: 'delivered',
            product_name: request.serviceType,
            unique_element: request.recipientPhone,
            unit_price: Number(request.amountKobo / 100n),
          },
        },
      },
    };
  }

  async checkStatus(providerReference: string): Promise<VtuStatusQueryResponse> {
    if (config.APP_ENV === 'production') {
      throw new Error('SECURITY VIOLATION: Mock provider cannot be executed in production environment.');
    }

    return {
      status: 'SUCCESS',
      providerReference,
      message: 'Reconciled successfully via mock query',
      rawResponse: { reconciled: true },
    };
  }
}
