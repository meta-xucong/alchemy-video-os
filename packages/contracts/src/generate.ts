import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stringify } from "yaml";

import { createContractDocuments } from "./specifications.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(packageRoot, "..", "..", "contracts");
const documents = createContractDocuments();

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "openapi.json"), `${JSON.stringify(documents.openApi, null, 2)}\n`),
  writeFile(resolve(outputDirectory, "openapi.yaml"), stringify(documents.openApi)),
  writeFile(resolve(outputDirectory, "asyncapi.json"), `${JSON.stringify(documents.asyncApi, null, 2)}\n`),
  writeFile(resolve(outputDirectory, "asyncapi.yaml"), stringify(documents.asyncApi)),
  writeFile(resolve(outputDirectory, "platform-contracts.schema.json"), `${JSON.stringify(documents.jsonSchema, null, 2)}\n`),
]);

console.log(`Generated contract documents in ${outputDirectory}`);
