# share-page

Tiny Vercel project that serves branded product links like
`https://p.anandjewelry.com/<product-id>` with an Open Graph preview
(title + image) for WhatsApp. Deployed separately from the billing app.

## Deploy

1. Push the repo to GitHub.
2. Vercel -> Add New -> Project -> import the repo.
3. Root Directory -> Edit -> select `share-page`.
4. Environment Variables:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY   (server only, never in the app)
5. Deploy.
6. Settings -> Domains -> add `p.anandjewelry.com`, then in your DNS add
   CNAME  p  ->  cname.vercel-dns.com

## Test

Open https://p.anandjewelry.com/<real product id>, then check the preview at
https://developers.facebook.com/tools/debug (WhatsApp reads the same tags).

## App side

In src/lib/whatsappShare.ts, the product line should use:
  https://p.anandjewelry.com/<product id>

## Notes

- Keep product images under ~300 KB or WhatsApp may skip the thumbnail.
- WhatsApp caches previews per URL.
- Edit SITE_NAME / SITE_URL / SHARE_BASE at the top of api/p.js if needed.
