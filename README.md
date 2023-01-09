# lsa-cg-scraper-js

This is a series of Node scripts used to retrieve data from the University of Michigan [LSA course guide](https://www.lsa.umich.edu/cg/).

Install dependencies by running `yarn install` or `npm install`.

## Scripts

The first script to run is `cache.js`. This will generate a list of every undergraduate and graduate course in every department for a given term. Run with `node cache.js`. We call this a caching script because we expect that for the most part, new courses are not added every hour of the day. Most courses are probably on the course guide by the start of registrations but in the case that new courses are added, they will be added to the cache. We ideally want to run this once a day to add newly added courses to the list of possible courses that our main script will use.

With the output of `cache.js`, we can run our `main.js` script. This will create a single overview file listing each course, along with some statistics such as capacity, availability and waitlist. It will also create a CSV file for each course with realtime data.

After the main script runs, a `merge.js` script runs in order to merge stubs into a single file by appending stubs to a general file for that course. We want to separate getting real time data from merging data because merging data is time intensive.

## AWS deployment

This can be deployed to AWS with three Lambda functions. Each function will need the following permissions: Lambda basic execution, S3 list and write and CloudFront create invalidation (`lsa-cg-scraper` execution role). Each function should run with Node.js 16.x with x86_64 architecture.

Run `yarn zip` to create ZIP files for each script that can be uploaded to AWS.

- For `cache.js`, change the Lambda function handler from `index.handler` to `cache.handler`. Add an EventBridge trigger that runs daily. This function is set to have 1024 MB of memory, 512 MB of ephemeral storage and a 5 minute timeout.
- For `main.js`, change the Lambda function handler from `index.handler` to `main.handler`. Add an EventBridge trigger that runs hourly. This function is set to have 2500 MB of memory, 512 MB of ephemeral storage and a 12 minute timeout.
- For `merge.js`, change the Lambda function handler from `index.handler` to `merge.handler`. Add an EventBridge trigger that runs hourly. It should run a few minutes after the main function runs, at least 15 to 30 minutes after. This function is set to have 1600 MB of memory, 512 MB of ephemeral storage and a 15 minute timeout.

You should keep track of monitoring logs and your billing. If there are function invocation failures, it may be because of time constraints or memory shortage. The merge function is most susceptible to running out of storage of time since each course file will become larger, and will require more time to read in each successive merge.
