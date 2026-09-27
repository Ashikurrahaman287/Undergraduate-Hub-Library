import { randomUUID } from "node:crypto";
import { File, Storage } from "@google-cloud/storage";
import { getSupabaseConfig } from "../auth";

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

type StoredFile = {
  contentType: string;
  body: Buffer | NodeJS.ReadableStream;
};

function parsePath(path: string) {
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts.length < 2) throw new Error("Invalid object path.");
  return { bucket: parts[0], name: parts.slice(1).join("/") };
}

function supabaseStorageConfig() {
  const config = getSupabaseConfig();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "payment-screenshots";
  if (!config?.serviceRoleKey) return null;
  return { ...config, bucket };
}

function objectName(objectPath: string) {
  if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
  const name = objectPath.slice("/objects/".length);
  if (!name || name.includes("..") || name.startsWith("/")) {
    throw new ObjectNotFoundError();
  }
  return name;
}

function supabaseStorageUrl(config: ReturnType<typeof supabaseStorageConfig>, name: string) {
  if (!config) throw new Error("Supabase Storage is not configured.");
  return `${config.url}/storage/v1/object/${config.bucket}/${name
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
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
    const config = supabaseStorageConfig();
    const screenshotName = `payment-screenshots/${randomUUID()}`;
    const objectPath = `/objects/${screenshotName}`;
    if (config) {
      return {
        uploadURL: `/api/storage/uploads?objectPath=${encodeURIComponent(objectPath)}`,
        objectPath,
      };
    }

    const path = `${this.privateDir()}/${screenshotName}`;
    const { bucket, name } = parsePath(path);
    const uploadURL = await signUrl(bucket, name);
    return { uploadURL, objectPath };
  }

  async upload(objectPath: string, data: Buffer, contentType: string) {
    const config = supabaseStorageConfig();
    if (!config) throw new Error("Supabase Storage is not configured.");
    const response = await fetch(supabaseStorageUrl(config, objectName(objectPath)), {
      method: "POST",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": contentType,
        "x-upsert": "false",
      },
      body: data,
    });
    if (!response.ok) {
      throw new Error(`Supabase Storage upload failed with HTTP ${response.status}.`);
    }
  }

  async file(objectPath: string): Promise<StoredFile> {
    const config = supabaseStorageConfig();
    if (config) {
      const response = await fetch(
        `${config.url}/storage/v1/object/authenticated/${config.bucket}/${objectName(objectPath)
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        {
          headers: {
            apikey: config.serviceRoleKey,
            Authorization: `Bearer ${config.serviceRoleKey}`,
          },
        },
      );
      if (response.status === 404) throw new ObjectNotFoundError();
      if (!response.ok) {
        throw new Error(`Supabase Storage download failed with HTTP ${response.status}.`);
      }
      return {
        contentType: response.headers.get("content-type") || "application/octet-stream",
        body: Buffer.from(await response.arrayBuffer()),
      };
    }

    const { bucket, name } = parsePath(`${this.privateDir()}/${objectPath.slice("/objects/".length)}`);
    const file: File = objectStorageClient.bucket(bucket).file(name);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    const [metadata] = await file.getMetadata();
    return {
      contentType: String(metadata.contentType ?? "application/octet-stream"),
      body: file.createReadStream(),
    };
  }
}