import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
// import { fromIni } from "@aws-sdk/credential-providers";
import { csvFormat, csvParse } from "d3-dsv";
import { group } from "d3-array";
import fetch from "node-fetch";
import { eachLimit } from "async";

export const handler = async () => {
  let puts = 0;

  const bucket = "data.michigandaily.com";
  const winter = "course-tracker/winter-2023";

  const region = "us-east-2";
  const client = new S3Client({
    region,
    // credentials: fromIni({ profile: "sink" }),
  });

  const cloudfront = new CloudFrontClient({ region });

  const lister = new ListObjectsV2Command({ Bucket: bucket, Prefix: `${winter}/stubs/stub-` });
  const list = await client.send(lister);

  if (list.KeyCount === 0) {
    console.log("No stubs to merge");
    return;
  }

  const stubs = list.Contents.map(d => ({ Key: d.Key }));

  for await (const { Key } of stubs) {
    const stubRes = await fetch(`https://${bucket}/${Key}`);
    const stubText = await stubRes.text();
    const stub = csvParse(stubText);

    const stubByCourse = group(stub, d => d.Course);
    const NUM_OPERATIONS = 25;
    await eachLimit(stubByCourse.entries(), NUM_OPERATIONS, async ([k, v]) => {
      const department = k.slice(0, -3).toLowerCase();
      const number = +k.slice(-3);

      const s = v.map(({ Course, ...attributes }) => attributes)

      let csv;

      let mainRes;
      try {
        mainRes = await fetch(`https://${bucket}/${winter}/courses/${department}/${department}-${number}.csv`);
      } catch (e) {
        return;
      }
      if (mainRes.ok) {
        const mainText = await mainRes.text();
        const main = csvParse(mainText);

        if (Date.parse(main.at(-1).Time) >= Date.parse(s.at(0).Time)) {
          return;
        } else {
          csv = [...main, ...s];
        }
      } else {
        if (mainRes.status === 404) {
          csv = s;
        } else {
          return;
        }
      }

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${winter}/courses/${department}/${department}-${number}.csv`,
          Body: csvFormat(csv),
          ContentType: "text/csv",
          CacheControl: "max-age=3600"
        })
      );
      puts++;
    })

    const invalidate = new CreateInvalidationCommand({
      DistributionId: "E1FI50AV220BXR",
      InvalidationBatch: {
        CallerReference: new Date().toISOString(),
        Paths: {
          Quantity: 1,
          Items: ["/" + winter + "/courses/*"],
        },
      },
    });
    await cloudfront.send(invalidate);
  }

  if (stubs.length > 0) {
    const remover = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: stubs,
      }
    });
    await client.send(remover);
  }

  console.log("PUT:", puts, "merges");
};

handler();
