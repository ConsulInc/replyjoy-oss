import crypto from "node:crypto";

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

