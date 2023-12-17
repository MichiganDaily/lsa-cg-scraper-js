import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { JSDOM } from "jsdom";
import fetch from "node-fetch";
import { csvFormat } from "d3-dsv";
import { eachLimit } from "async";
import { createHash } from "node:crypto";

/**
 * Retrieve a set of department slugs (e.g. EECS, ENGLISH, POLSCI, etc.) from the course guide depending on a term and type.
 * As an example, running `getDepartments("w_23_2420", "ug")` will retrieve the department slugs from the table on https://www.lsa.umich.edu/cg/cg_subjectlist.aspx?termArray=w_23_2420&cgtype=ug&allsections=true
 * @param {string} term - the term we should retrieve departments from
 * @param {('ug'|'gr')} type - 'ug' if the departments should be for undergraduate classes, 'gr' if the departments should be for graduate classes
 *
 * @returns {Promise<Set<string>>} a set of string slugs
 */
const getDepartments = async (term, type) => {
  const url = new URL("https://www.lsa.umich.edu/cg/cg_subjectlist.aspx");
  url.searchParams.set("termArray", term);
  url.searchParams.set("cgtype", type);
  url.searchParams.set("allsections", true);

  const response = await fetch(url.href);
  const html = await response.text();
  const { body } = new JSDOM(html).window.document;

  const tableSelector = "#contentMain_panelSubjectList table";
  const slugSelector = `${tableSelector} tr > td:nth-child(1)`;
  const slugNodes = body.querySelectorAll(slugSelector);
  const slugs = new Set(Array.from(slugNodes).map((d) => d.textContent.trim()));
  return slugs;
};

/**
 * Given the departments of a term and type specification, return some information about all of the courses from those departments.
 * A single department URL will look something like the following:
 * https://www.lsa.umich.edu/cg/cg_results.aspx?termArray=w_23_2420&cgtype=ug&allsections=true&show=1000&department=AAS
 * @param {Set<string>} departments - a set of department slugs
 * @param {string} term - the term we should retrieve departments from
 * @param {('ug'|'gr')} type - 'ug' if the departments should be for undergraduate classes, 'gr' if the departments should be for graduate classes
 * @returns {Promise<Map<string, {suffix: string, title: string}>} a mapping from a course slug (e.g., EECS 485) to partial content query parameter suffix and a title.
 */
const getCourses = async (departments, term, type) => {
  const url = new URL("https://www.lsa.umich.edu/cg/cg_results.aspx");
  url.searchParams.set("termArray", term);
  url.searchParams.set("cgtype", type);
  url.searchParams.set("allsections", true);
  url.searchParams.set("show", 1000); // the number of courses that should be shown on each page query.

  const map = new Map();

  const NUM_OPERATIONS = 25;
  await eachLimit(departments, NUM_OPERATIONS, async (department) => {
    url.searchParams.set("department", department);
    const response = await fetch(url.href);
    const html = await response.text();
    const { body } = new JSDOM(html).window.document;

    const courses = body.querySelectorAll(".row.ClassRow.ClassHyperlink");
    courses.forEach((course) => {
      const [dept, number, _, title] = course
        .querySelector(".row.toppadding_main.bottompadding_interior font")
        .textContent.trim()
        .split("\n")
        .map((d) => d.trim());

      const slug = dept + number;

      const path = course.getAttribute("data-url");
      const url = new URL(path, "https://www.lsa.umich.edu/cg/");
      const suffix = url.searchParams.get("content").split(slug).at(-1);

      // A course can have multiple sections but we do not need to store information about each section.
      // Take for example EECS 485 for the Winter 2022 semester. The page for section 4 can be found at
      // https://lsa.umich.edu/cg/cg_detail.aspx?content=2370EECS485004&termArray=w_22_2370
      // Note that this page has information for every other section that is a part of EECS 485.
      // It is specified as section 4's page because it will highlight that row.
      // Since each course can be specified from just one page, we don't need to store multiple
      // suffixes for each course slug.
      if (!map.has(slug)) {
        map.set(slug, { suffix, title });
      }
    });
  });

  return map;
};

export const handler = async () => {
  const term = "w_23_2420";
  const ug = await getDepartments(term, "ug");
  const gr = await getDepartments(term, "gr");

  const ugCourses = await getCourses(ug, term, "ug");
  const grCourses = await getCourses(gr, term, "gr");

  const courses = new Map([...ugCourses, ...grCourses]);

  const body = csvFormat(
    Array.from(courses).map((course) => ({
      course: course[0],
      suffix: course[1].suffix,
      title: course[1].title
    }))
  );

  if (body === undefined || body.length === 0) {
    return;
  }

  const etag = `W/"${createHash("md5").update(body).digest("hex")}"`;

  const bucket = "stash.michigandaily.com";
  const key = "course-tracker/winter-2023/cache-courses.csv";

  const res = await fetch(`https://${bucket}/${key}`);
  if (!res.ok || res.headers.get("etag") !== etag) {
    const bucketParams = {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "text/csv",
      CacheControl: "s-maxage=86300",
    };

    const region = "us-east-2";
    const client = new S3Client({ region });
    await client.send(new PutObjectCommand(bucketParams));

    const cloudfront = new CloudFrontClient({ region });
    const invalidate = new CreateInvalidationCommand({
      DistributionId: "E1FI50AV220BXR",
      InvalidationBatch: {
        CallerReference: new Date().toISOString(),
        Paths: {
          Quantity: 1,
          Items: ["/" + key],
        },
      },
    });
    await cloudfront.send(invalidate);
  }
};

handler();