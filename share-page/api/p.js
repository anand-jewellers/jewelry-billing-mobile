const { createClient } = require('@supabase/supabase-js');

const SITE_NAME = 'Anand Jewelry';
const SITE_URL = 'https://www.anandjewelry.com';
const SHARE_BASE = 'https://p.anandjewelry.com';
const BUCKET = 'product-images';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Accepts a path inside the bucket, a path prefixed with the bucket name,
// or an already-full public URL, and returns a public URL.
function publicImageUrl(storagePath) {
  if (!storagePath) return null;
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  const clean = String(storagePath).replace(new RegExp(`^/?${BUCKET}/`), '');
  return supabase.storage.from(BUCKET).getPublicUrl(clean).data.publicUrl;
}

function notFound(res, msg) {
  res.status(404).setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60');
  return res.send(msg);
}

module.exports = async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound(res, 'Not found');

  const { data: p, error } = await supabase
    .from('products')
    .select(
      `id, product_name, net_weight, status,
       metals(name), purities(name),
       product_images(storage_path, is_primary, sort_order)`
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Supabase error:', error.message);
    return res.status(500).send('Something went wrong');
  }
  if (!p || p.status === 'discontinued') return notFound(res, 'Product not found');

  // Primary image first, otherwise lowest sort_order
  const images = [...(p.product_images || [])].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
  const img = images[0] ? publicImageUrl(images[0].storage_path) : null;

  const title = esc(p.product_name);
  const desc = esc(
    [
      p.metals?.name,
      p.purities?.name,
      p.net_weight != null ? `${Number(p.net_weight).toFixed(3)} g` : null,
    ]
      .filter(Boolean)
      .join(' • ')
  );
  const pageUrl = `${SHARE_BASE}/${id}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} | ${SITE_NAME}</title>
<meta name="description" content="${desc}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${pageUrl}" />
${img ? `<meta property="og:image" content="${esc(img)}" />` : ''}
<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}" />
</head>
<body style="font-family:Arial,sans-serif;max-width:480px;margin:24px auto;padding:0 16px;text-align:center">
${img ? `<img src="${esc(img)}" alt="${title}" style="max-width:100%;border-radius:12px" />` : ''}
<h2>${title}</h2>
<p>${desc}</p>
<p><a href="${SITE_URL}">Visit ${SITE_NAME}</a></p>
</body></html>`);
};
