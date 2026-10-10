import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { ListObjectsV2Command, S3Client, S3ServiceException } from "@aws-sdk/client-s3";

// Keep the real SDK middleware, XML parser, and command deserializer. Only the
// HTTP transport is synthetic, so these tests need no service or credentials.
// Regression source: fast-xml-parser v5.7.2 / b1d5b907ccbfbfbdbbeecc1f273bf20973d305e3,
// which restores numeric external entities used by AWS SDK 3.750.0 parseXmlBody.
const createXmlClient = (xml: string, statusCode = 200) => {
  let requests = 0;
  const client = new S3Client({
    endpoint: "https://s3.invalid",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    maxAttempts: 1,
    requestHandler: {
      async handle(request: Parameters<S3Client["config"]["requestHandler"]["handle"]>[0]) {
        requests += 1;
        assert.equal(request.method, "GET");
        assert.equal(request.path, "/xml-regression/");
        assert.equal(request.query?.["list-type"], "2");
        return {
          response: {
            statusCode,
            headers: {
              "content-type": "application/xml",
              "x-amz-request-id": "xml-regression-request",
            },
            body: Readable.from([Buffer.from(xml)]),
          },
        };
      },
    },
  });
  return { client, requests: () => requests };
};

const listXml = (content: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${content}</ListBucketResult>`;

test("real S3 XML deserialization accepts an empty ListObjectsV2 cleanup listing", async () => {
  const { client, requests } = createXmlClient(listXml(
    "<Name>xml-regression</Name><Prefix/><KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>",
  ));
  try {
    const result = await client.send(new ListObjectsV2Command({ Bucket: "xml-regression" }));
    assert.equal(result.Name, "xml-regression");
    assert.equal(result.KeyCount, 0);
    assert.equal(result.MaxKeys, 1000);
    assert.equal(result.IsTruncated, false);
    assert.equal(result.Prefix, "");
    assert.equal(result.Contents, undefined);
    assert.equal(result.$metadata.httpStatusCode, 200);
    assert.equal(result.$metadata.requestId, "xml-regression-request");
    assert.equal(requests(), 1);
  } finally {
    client.destroy();
  }
});

test("real S3 XML deserialization preserves numeric and named entities in object keys", async () => {
  const { client } = createXmlClient(listXml(
    "<Name>xml-regression</Name><KeyCount>2</KeyCount><IsTruncated>true</IsTruncated>" +
    "<NextContinuationToken>next&amp;page</NextContinuationToken>" +
    "<Contents><Key> ws/line&#xD;break&#10;&amp;&lt;&gt;&quot;&apos;.png </Key>" +
    "<LastModified>2026-10-10T00:00:00.000Z</LastModified><ETag>&quot;etag-one&quot;</ETag><Size>17</Size><StorageClass>STANDARD</StorageClass></Contents>" +
    "<Contents><Key>ws/second.png</Key><Size>0</Size></Contents>" +
    "<CommonPrefixes><Prefix>ws/shared&amp;assets/</Prefix></CommonPrefixes>",
  ));
  try {
    const result = await client.send(new ListObjectsV2Command({ Bucket: "xml-regression" }));
    assert.equal(result.KeyCount, 2);
    assert.equal(result.IsTruncated, true);
    assert.equal(result.NextContinuationToken, "next&page");
    assert.deepEqual(result.Contents?.map(({ Key, Size }) => ({ Key, Size })), [
      { Key: " ws/line\rbreak\n&<>\"'.png ", Size: 17 },
      { Key: "ws/second.png", Size: 0 },
    ]);
    assert.equal(result.Contents?.[0]?.ETag, '"etag-one"');
    assert.equal(result.Contents?.[0]?.LastModified?.toISOString(), "2026-10-10T00:00:00.000Z");
    assert.equal(result.Contents?.[0]?.StorageClass, "STANDARD");
    assert.deepEqual(result.CommonPrefixes, [{ Prefix: "ws/shared&assets/" }]);
  } finally {
    client.destroy();
  }
});

test("real S3 XML deserialization keeps a singleton Contents element as an array", async () => {
  const { client } = createXmlClient(listXml(
    "<KeyCount>1</KeyCount><IsTruncated>false</IsTruncated><Contents><Key>ws/single.png</Key><Size>42</Size></Contents>",
  ));
  try {
    const result = await client.send(new ListObjectsV2Command({ Bucket: "xml-regression" }));
    assert.deepEqual(result.Contents, [{ Key: "ws/single.png", Size: 42 }]);
  } finally {
    client.destroy();
  }
});

test("real S3 XML deserialization retains URL-encoded keys and opaque continuation tokens", async () => {
  const { client } = createXmlClient(listXml(
    "<EncodingType>url</EncodingType><KeyCount>1</KeyCount><IsTruncated>true</IsTruncated>" +
    "<NextContinuationToken>opaque+token/with=padding&amp;part</NextContinuationToken>" +
    "<Contents><Key>ws%2Fspace%20%26%20plus%2B.png</Key><Size>17</Size></Contents>",
  ));
  try {
    const result = await client.send(new ListObjectsV2Command({ Bucket: "xml-regression", EncodingType: "url" }));
    assert.equal(result.EncodingType, "url");
    assert.equal(result.Contents?.[0]?.Key, "ws%2Fspace%20%26%20plus%2B.png");
    assert.equal(result.NextContinuationToken, "opaque+token/with=padding&part");
  } finally {
    client.destroy();
  }
});

test("real S3 XML error deserialization preserves service error and HTTP metadata", async () => {
  const { client, requests } = createXmlClient(
    '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>denied &amp; blocked</Message></Error>',
    403,
  );
  try {
    await assert.rejects(client.send(new ListObjectsV2Command({ Bucket: "xml-regression" })), (error: unknown) => {
      assert.ok(error instanceof S3ServiceException);
      assert.equal(error.name, "AccessDenied");
      assert.equal(error.message, "denied & blocked");
      assert.equal(error.$metadata.httpStatusCode, 403);
      assert.equal(error.$metadata.requestId, "xml-regression-request");
      assert.equal(error.$metadata.attempts, 1);
      return true;
    });
    assert.equal(requests(), 1);
  } finally {
    client.destroy();
  }
});

test("real S3 XML deserialization still rejects a malformed listing", async () => {
  const { client } = createXmlClient("<ListBucketResult><Contents></ListBucketResult>");
  try {
    await assert.rejects(
      client.send(new ListObjectsV2Command({ Bucket: "xml-regression" })),
      /Expected closing tag 'Contents'/,
    );
  } finally {
    client.destroy();
  }
});
