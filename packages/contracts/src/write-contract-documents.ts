import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stringify } from "yaml";

import { createContractDocuments } from "./specifications.js";

export const CONTRACT_ARTIFACT_NAMES = [
  "openapi.json",
  "openapi.yaml",
  "asyncapi.json",
  "asyncapi.yaml",
  "platform-contracts.schema.json",
] as const;

type ContractArtifactName = (typeof CONTRACT_ARTIFACT_NAMES)[number];
const GENERATION_LOCK_NAME = ".contract-generation.lock";
const LOCK_RETRY_DELAY_MS = 20;
const LOCK_RETRY_LIMIT = 500;

const contractArtifactContents = (): Record<ContractArtifactName, string> => {
  const documents = createContractDocuments();

  return {
    "openapi.json": `${JSON.stringify(documents.openApi, null, 2)}\n`,
    "openapi.yaml": stringify(documents.openApi),
    "asyncapi.json": `${JSON.stringify(documents.asyncApi, null, 2)}\n`,
    "asyncapi.yaml": stringify(documents.asyncApi),
    "platform-contracts.schema.json": `${JSON.stringify(documents.jsonSchema, null, 2)}\n`,
  };
};

const writeAtomically = async (outputDirectory: string, name: ContractArtifactName, contents: string) => {
  const destination = resolve(outputDirectory, name);
  const temporary = resolve(outputDirectory, `.${name}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

const waitForLock = () => new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));

const acquireGenerationLock = async (outputDirectory: string) => {
  const lockPath = resolve(outputDirectory, GENERATION_LOCK_NAME);

  for (let attempt = 0; attempt < LOCK_RETRY_LIMIT; attempt += 1) {
    try {
      return { handle: await open(lockPath, "wx"), lockPath };
    } catch (error: unknown) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      await waitForLock();
    }
  }

  throw new Error("Timed out waiting for the contract generation lock.");
};

export const writeContractDocuments = async (outputDirectory: string) => {
  await mkdir(outputDirectory, { recursive: true });
  const lock = await acquireGenerationLock(outputDirectory);

  try {
    const artifacts = contractArtifactContents();
    await Promise.all(
      CONTRACT_ARTIFACT_NAMES.map((name) => writeAtomically(outputDirectory, name, artifacts[name])),
    );
  } finally {
    await lock.handle.close();
    await rm(lock.lockPath, { force: true });
  }
};
