# C10 document Worker source record

- Platform-owned code: the Worker, queue relay, Runtime client, conversion validation, and persistence adapter are new platform code.
- Upstream dependency: `microsoft/markitdown` at `fd239d5d2be43d9b68329730206b9312c7d5a388` is used only inside `services/document-runtime` through its documented stream conversion API.
- Boundary: this Worker receives source bytes only from `StoragePort`, calls the private Runtime endpoint, and never receives a user URL, browser credential, object key in a queue message, or database access outside repository interfaces.
