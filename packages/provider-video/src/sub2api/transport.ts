export type Sub2ApiTransportRequest = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

export type Sub2ApiTransportResponse = {
  status: number;
  headers?: Readonly<Record<string, string>>;
  json?: unknown;
  stream?: ReadableStream<Uint8Array>;
};

/**
 * The adapter only knows protocol-relative paths. A later, explicitly authorized
 * runtime composition may supply network behavior; C07 supplies no such default.
 */
export interface Sub2ApiTransport {
  request(input: Sub2ApiTransportRequest): Promise<Sub2ApiTransportResponse>;
}
