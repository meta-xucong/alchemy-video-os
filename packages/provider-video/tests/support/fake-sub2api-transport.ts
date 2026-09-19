import type {
  Sub2ApiTransport,
  Sub2ApiTransportRequest,
  Sub2ApiTransportResponse,
} from "../../src/sub2api/transport.js";

export class FakeSub2ApiTransport implements Sub2ApiTransport {
  readonly requests: Sub2ApiTransportRequest[] = [];

  constructor(private readonly responses: Sub2ApiTransportResponse[]) {}

  async request(input: Sub2ApiTransportRequest): Promise<Sub2ApiTransportResponse> {
    this.requests.push(structuredClone(input));
    const response = this.responses.shift();
    if (!response) throw new Error("The fake SUB2API transport received an unexpected request.");
    return response;
  }
}
