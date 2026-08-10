export interface PreviewGatewayRedeemResult {
  readonly cookieValue: string;
  readonly expiresAt: string;
}

export interface PreviewGatewayRequest {
  readonly previewId: string;
  readonly method: 'GET' | 'HEAD';
  readonly pathname: string;
  readonly search: string;
  readonly accessCookie: string;
  readonly headers: Headers;
  readonly signal: AbortSignal;
}

export interface PreviewGatewayService {
  redeem(previewId: string, ticket: string): Promise<PreviewGatewayRedeemResult | null>;
  proxy(request: PreviewGatewayRequest): Promise<Response>;
}

export class PreviewGatewayError extends Error {
  readonly status: 401 | 404 | 410 | 502 | 504;

  constructor(message: string, status: PreviewGatewayError['status'], cause?: unknown) {
    super(message, { cause });
    this.name = 'PreviewGatewayError';
    this.status = status;
  }
}
