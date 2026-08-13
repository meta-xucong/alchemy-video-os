import { randomBytes } from "node:crypto";

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const encodeTime = (timestamp: number) => {
  let value = timestamp;
  let encoded = "";

  for (let index = 0; index < 10; index += 1) {
    encoded = ULID_ALPHABET[value % 32] + encoded;
    value = Math.floor(value / 32);
  }

  return encoded;
};

const encodeRandom = () => Array.from(randomBytes(16), (byte) => ULID_ALPHABET[byte & 31]).join("");

export const createPrefixedId = (prefix: string) => `${prefix}_${encodeTime(Date.now())}${encodeRandom()}`;

export const createRequestId = () => createPrefixedId("req");
