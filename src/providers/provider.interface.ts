export interface VtuTopupRequest {
  reference: string;
  serviceType: 'airtime' | 'data';
  operator: string;
  recipientPhone: string;
  amountKobo: bigint;
  packageCode?: string;
}

export interface VtuTopupResponse {
  success: boolean;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  providerReference: string;
  message?: string;
  rawResponse?: Record<string, unknown>;
}

export interface VtuStatusQueryResponse {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  providerReference: string;
  message?: string;
  rawResponse?: Record<string, unknown>;
}

export interface IVtuProvider {
  name: string;
  topup(request: VtuTopupRequest): Promise<VtuTopupResponse>;
  checkStatus(providerReference: string): Promise<VtuStatusQueryResponse>;
}
