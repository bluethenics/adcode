/**
 * The same rules as `.dependency-cruiser.cjs`, with the `__fixtures__` exclusion lifted.
 *
 * Used by `firewall.test.ts` to run the real firewall rule against a deliberately
 * violating fixture, proving the guard fires rather than merely that it passes.
 */
const base = require("./.dependency-cruiser.cjs");

module.exports = {
  ...base,
  options: {
    ...base.options,
    exclude: { path: "(^|/)node_modules/" },
  },
};
