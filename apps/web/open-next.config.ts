/**
 * How `@opennextjs/cloudflare` builds this app for the Worker runtime.
 *
 * Deliberately the default configuration. The two things it would otherwise be tempting to
 * add - an R2 bucket for the incremental cache and a KV namespace for tags - both cost
 * setup steps and neither is needed yet: the blog revalidates on a timer rather than on
 * demand, so a cache miss costs one render rather than a wrong page.
 *
 * When traffic makes that render worth avoiding, `incrementalCache` is where it goes, and
 * SETUP.md is where the extra step belongs.
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
