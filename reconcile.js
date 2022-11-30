import { writeFileSync } from "node:fs";
import fetch from "node-fetch";
import { csvParse, autoType, csvFormat } from "d3-dsv";
import { max, index, rollup, sum } from "d3-array";

const csv = async (url) => {
  const req = await fetch(url);
  const res = await req.text();
  return csvParse(res, autoType);
}

const main = async () => {
  const bucket = "data.michigandaily.com";
  const prefix = "course-tracker/winter-2023";

  const cache = await csv(`https://${bucket}/${prefix}/cache-courses.csv`);
  const overview = await csv(`https://${bucket}/${prefix}/overview.csv`);
  const courseIndex = index(overview, d => d.department + d.number);

  for await (const course of cache) {
    const department = course.course.slice(0, -3).toLowerCase();
    const number = course.course.slice(-3);

    const url = `https://${bucket}/${prefix}/courses/${department}/${department}-${number}.csv`;
    const file = await csv(url);
    const sections = file.filter(d => d.Section.includes("LEC") || d.Section.includes("SEM") || d.Section.includes("REC") || d.Section.includes("IND"))
    const potential = max(rollup(sections, v => sum(v, d => +d["Open Seats"]), d => d.Time).values());

    const slug = department.toUpperCase() + number;
    if (potential !== undefined && courseIndex.has(slug)) {
      const c = courseIndex.get(slug);
      const maximum = c.capacity;
      const available = c.available;
      if (potential > maximum) {
        console.log(slug, potential, maximum);
        courseIndex.set(slug, { ...c, capacity: potential, percent_available: available / potential })
      }
    }
  }

  writeFileSync("./overview.csv", csvFormat(Array.from(courseIndex.values())))
}

main();