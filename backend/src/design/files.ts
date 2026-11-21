/** Every side file a poster document refers to (background, cut-outs, print files), as addresses. */
export function designFileUrls(design: any, out: Set<string>): Set<string> {
  const doc = design?.doc;
  const add = (url: unknown) => {
    if (typeof url === 'string' && url) out.add(url);
  };
  add(doc?.background?.url);
  for (const p of doc?.photos || []) add(p?.cutout?.url);
  add(design?.pdf_a4);
  add(design?.pdf_a3);
  for (const url of Object.values(design?.sizes || {})) add(url);
  return out;
}
