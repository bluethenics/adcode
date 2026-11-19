/** Price in cents for a product, from the catalogue. */
export function getPrice(catalogue, sku) {
  const item = catalogue.find((entry) => entry.sku === sku);
  if (item === undefined) throw new Error(`unknown sku ${sku}`);
  return item.cents;
}
