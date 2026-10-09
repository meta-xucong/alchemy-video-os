import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;

if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error("Isolated S3 configuration is required to initialize the integration-test bucket.");
}

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

try {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
} catch (error) {
  if (!(error instanceof Error) || !["BucketAlreadyExists", "BucketAlreadyOwnedByYou"].includes(error.name)) {
    throw error;
  }
} finally {
  client.destroy();
}
