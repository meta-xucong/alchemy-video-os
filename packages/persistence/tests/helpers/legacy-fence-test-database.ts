// Both legacy-fence suites create/drop databases, so share one strict endpoint
// guard and call it before constructing a PostgreSQL client or pool.
export const assertLoopbackTestDatabaseUrl = (connectionString: string) => {
  // pg-connection-string rewrites URLs containing literal spaces before parsing;
  // reject them so this guard and the driver's effective host cannot diverge.
  if (/\s/.test(connectionString)) {
    throw new Error("LEGACY_FENCE_TEST_DATABASE_URL must not contain literal whitespace.");
  }
  let connection: URL;
  try {
    connection = new URL(connectionString);
  } catch {
    throw new Error("LEGACY_FENCE_TEST_DATABASE_URL must be a PostgreSQL URL for a loopback test server.");
  }
  if (connection.protocol !== "postgres:" && connection.protocol !== "postgresql:") {
    throw new Error("LEGACY_FENCE_TEST_DATABASE_URL must use the PostgreSQL URL scheme.");
  }
  // Accept one exact IPv4 loopback literal. Do not normalize host strings:
  // the PostgreSQL driver must receive the exact value that this guard checked.
  const loopbackHosts = new Set(["127.0.0.1"]);
  const hosts = [
    connection.hostname,
    ...connection.searchParams.getAll("host"),
    ...connection.searchParams.getAll("hostaddr"),
  ];
  if (hosts.some((host) => !loopbackHosts.has(host))) {
    throw new Error("LEGACY_FENCE_TEST_DATABASE_URL must use the exact loopback host 127.0.0.1 without aliases or formatting.");
  }
  return connectionString;
};
