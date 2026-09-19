import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeContractDocuments } from "./write-contract-documents.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(packageRoot, "..", "..", "contracts");

await writeContractDocuments(outputDirectory);

console.log(`Generated contract documents in ${outputDirectory}`);
