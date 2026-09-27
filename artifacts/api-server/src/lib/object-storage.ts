import { randomUUID } from "node:crypto";
import { File, Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {}

function parsePath(path: string) {
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts.length < 2) throw new Error("Invalid object path.");
  return { bucket: parts[0], name: parts.slice(1).join("/") };
}

async function signUrl(bucket: string, name: string) {
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bucket_name: bucket, object_name: name, method: "PUT", expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }),
  });
  if (!response.ok) throw new Error("Unable to create upload URL.");
  const payload = (await response.json()) as { signed_url?: string };
  if (!payload.signed_url) throw new Error("Upload URL was not returned.");
  return payload.signed_url;
}

export class ObjectStorageService {
  private privateDir() {
    const value = process.env.PRIVATE_OBJECT_DIR;
    if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
    return value.replace(/\/$/, "");
  }

  async uploadUrl() {
    const path = `${this.privateDir()}/payment-screenshots/${randomUUID()}`;
    const { bucket, name } = parsePath(path);
    const uploadURL = await signUrl(bucket, name);
    return { uploadURL, objectPath: `/objects/${name}` };
  }

  async file(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const { bucket, name } = parsePath(`${this.privateDir()}/${objectPath.slice("/objects/".length)}`);
    const file = objectStorageClient.bucket(bucket).file(name);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }
}