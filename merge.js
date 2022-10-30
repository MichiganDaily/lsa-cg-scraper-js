import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";
import { csvFormat, csvParse } from "d3-dsv";
import fetch from "node-fetch";
import { eachLimit } from "async";

const chunk = (arr, size) => {
  return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => {
    return arr.slice(i * size, i * size + size);
  });
};

export const handler = async () => {
  const overviewRes = await fetch(
    "https://data.michigandaily.com/course-tracker/winter-2023/overview.csv"
  );
  const overviewText = await overviewRes.text();
  const overview = csvParse(overviewText);
  const courses = overview.map((d) => ({
    department: d.department,
    slug: d.department.toLowerCase() + "-" + d.number,
  }));

  const suffix = "2022-10-30T03:00:00.000Z";
  const prevSuffix = "2022-10-30T02:00:00.000Z";

  const region = "us-east-2";
  const client = new S3Client({
    region,
    credentials: fromIni({ profile: "sink" }),
  });

  const filesToDelete = Array();

  const bucket = "data.michigandaily.com";
  const prefix = "course-tracker/winter-2023/courses";

  const NUM_OPERATIONS = 20;
  await eachLimit(courses, NUM_OPERATIONS, async ({ department, slug }) => {
    const dept = department.toLowerCase();
    let stubRes = await fetch(
      `https://${bucket}/${prefix}/${dept}/${slug}-${suffix}.csv`
    );

    if (!stubRes.ok) {
      stubRes = await fetch(
        `https://${bucket}/${prefix}/${dept}/${slug}-${prevSuffix}.csv`
      );

      if (!stubRes.ok) {
        return;
      } else {
        filesToDelete.push(`${prefix}/${dept}/${slug}-${prevSuffix}.csv`);
      }
    } else {
      filesToDelete.push(`${prefix}/${dept}/${slug}-${suffix}.csv`);
    }

    const stubText = await stubRes.text();
    const stub = csvParse(stubText);

    let csv = stub;

    const mainRes = await fetch(
      `https://${bucket}/${prefix}/${dept}/${slug}.csv`
    );
    if (mainRes.ok) {
      const mainText = await mainRes.text();
      const main = csvParse(mainText);
      console.log("Appending to the main data file", slug);
      csv = [...main, ...stub];
    }

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}/${dept}/${slug}.csv`,
        Body: csvFormat(csv),
        ContentType: "text/csv",
        CacheControl: "max-age=3600",
      })
    );
  });

  if (filesToDelete.length > 0) {
    const chunks = chunk(
      filesToDelete.map((f) => ({ Key: f })),
      1000
    );

    for await (const chunk of chunks) {
      const remove = new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk,
        },
      });
      await client.send(remove);
    }
  }
};

handler();
