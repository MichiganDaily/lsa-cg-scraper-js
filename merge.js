import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";
import { csvFormat, csvParse } from "d3-dsv";
import fetch from "node-fetch";
import { eachLimit } from "async";

export const handler = async () => {
  const bucket = "data.michigandaily.com";
  const prefix = "course-tracker/winter-2023/courses";

  const region = "us-east-2";
  const client = new S3Client({
    region,
    credentials: fromIni({ profile: "sink" }),
  });

  let listOptions = {
    Bucket: bucket,
    Prefix: prefix,
    StartAfter: undefined,
  };

  let lister = new ListObjectsV2Command(listOptions);
  let list = await client.send(lister);

  while (list.KeyCount > 0) {
    const regex = new RegExp(
      /-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z.csv/
    );

    const stubs = list.Contents.filter((d) => regex.test(d.Key)).map((d) => ({
      Key: d.Key,
    }));

    const NUM_OPERATIONS = 20;
    await eachLimit(stubs, NUM_OPERATIONS, async ({ Key }) => {
      const filename = Key.substring(Key.lastIndexOf("/") + 1, Key.length);
      const [department, number] = filename.split("-");

      console.log(department + number);

      const stubRes = await fetch(`https://${bucket}/${Key}`);
      const stubText = await stubRes.text();
      const stub = csvParse(stubText);

      let csv = stub;

      const mainRes = await fetch(
        `https://${bucket}/${prefix}/${department}/${department}-${number}.csv`
      );
      if (mainRes.ok) {
        const mainText = await mainRes.text();
        const main = csvParse(mainText);

        if (main.at(-1).Time === stub.at(0).Time) {
          return;
        } else {
          csv = [...main, ...stub];
        }
      }

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/${department}/${department}-${number}.csv`,
          Body: csvFormat(csv),
          ContentType: "text/csv",
          CacheControl: "max-age=3600",
        })
      );
    });

    if (stubs.length > 0) {
      const remover = new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: stubs,
        },
      });
      await client.send(remover);
    }

    const lastKey = list.Contents.at(-1).Key;
    lister = new ListObjectsV2Command({ ...listOptions, StartAfter: lastKey });
    list = await client.send(lister);
  }
};

handler();
