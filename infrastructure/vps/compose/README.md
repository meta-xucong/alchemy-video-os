# Canonical Compose reference

The VPS adapter intentionally does not copy `docker-compose.video.yml`. The
canonical full-stack definition is:

```text
infrastructure/deploy/docker-compose.video.yml
```

The adapter script always resolves that fixed path from the repository root and
passes it to Docker Compose with the private env file
`/opt/alchemy-video/secrets/video.env`. The edge profile, service names,
healthchecks, restart policy, internal-only ports, and persistent volumes are
therefore defined in one place.

If the canonical Compose path, service names, or required deployment inputs
change, update `infrastructure/deploy/` first and then update the wrapper and
these references. Do not add a second VPS Compose file here: two definitions
would allow local and VPS behavior to drift and would weaken the deployment
review boundary.

The canonical deployment README remains authoritative for TLS bootstrap,
private configuration, real-Provider authorization, rollback, and backup
procedures.
