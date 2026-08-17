export type VeyraCreditTransportRequest = {
  method: "GET" | "POST";
  path: string;
  headers: Readonly<Record<string, string>>;
  body?: unknown;
};

export type VeyraCreditTransportResponse = {
  status: number;
  body: unknown;
};

export interface VeyraCreditTransport {
  request(input: VeyraCreditTransportRequest): Promise<VeyraCreditTransportResponse>;
}
