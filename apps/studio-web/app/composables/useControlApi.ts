export type HealthStatus = {
  data: {
    service: string;
    status: string;
  };
  request_id: string;
};

export function useControlApi() {
  async function health(): Promise<HealthStatus> {
    return $fetch<HealthStatus>("/api/v1/health");
  }

  return { health };
}
