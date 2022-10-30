# lsa-cg-scraper-js

Necessary role: Lambda basic execution, S3 List and Write, CloudFront create invalidation

## `cache.js`

Run `yarn zip-cache`.

Function name: `lsa-cg-scraper-course-cache`
Runtime: Node.js 16.x
Architecture: x86_64

Execution role: `lsa-cg-scraper`.

Upload a .zip file: `cache.zip`.
Change the handler from `index.handler` to `cache.handler`.
Set the timeout to 5 minutes.
Set the memory to 512MB.

Add EventBridge trigger with a `cron(0 10 * * ? *)` cron schedule (runs at 10AM UTC or 6AM ET).

## `main.js`

Run `yarn zip-main`.

Function name: `lsa-cg-scraper`
Runtime: Node.js 16.x
Architecture: x86_64

Execution role: `lsa-cg-scraper`.

Upload a .zip file: `main.zip`.
Change the handler from `index.handler` to `main.handler`.
Set the timeout to 10 minutes.
Set the memory to 4096MB.
Set ephemeral storage to 2048MB.

<!-- Add EventBridge trigger with a `cron(0 10 * * ? *)` cron schedule (runs at 10AM UTC or 6AM ET). -->
