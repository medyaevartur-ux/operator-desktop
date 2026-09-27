import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import dotenv from "dotenv";

dotenv.config();

const s3Client = new S3Client({
  region: "ru-7",
  endpoint: process.env.S3_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "",
    secretAccessKey: process.env.S3_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

const BUCKET = process.env.S3_BUCKET_NAME || "zhivaya-skazka";
const PUBLIC_DOMAIN = process.env.S3_PUBLIC_DOMAIN || `https://${BUCKET}.selstorage.ru`;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export interface UploadResult {
  url: string;
  filename: string;
  size: number;
  mime_type: string;
}

export async function uploadToS3(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  folder: string = "chat"
): Promise<UploadResult> {
  if (!ALLOWED_TYPES.includes(mimeType)) {
    throw new Error("Only images allowed: JPG, PNG, WebP, GIF");
  }

  if (buffer.length > MAX_SIZE) {
    throw new Error("Max file size 10MB");
  }

  const ext = originalName.split(".").pop()?.toLowerCase() || "jpg";
  const key = `${folder}/${randomUUID()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    ACL: "public-read",
  });

  await s3Client.send(command);

  return {
    url: `${PUBLIC_DOMAIN}/${key}`,
    filename: originalName,
    size: buffer.length,
    mime_type: mimeType,
  };
}