-- storage_policies.sql
-- Run in the NEW project (SQL Editor) AFTER:
--   1) schema.sql has been restored (needs public.is_admin())
--   2) the 3 buckets exist: product-images, company-assets, invoice-documents

-- ---------- company-assets ----------
DROP POLICY IF EXISTS "admin write company-assets" ON storage.objects;
CREATE POLICY "admin write company-assets" ON storage.objects
  AS PERMISSIVE FOR ALL TO public
  USING ((bucket_id = 'company-assets'::text) AND public.is_admin())
  WITH CHECK ((bucket_id = 'company-assets'::text) AND public.is_admin());

DROP POLICY IF EXISTS "public read company-assets" ON storage.objects;
CREATE POLICY "public read company-assets" ON storage.objects
  AS PERMISSIVE FOR SELECT TO public
  USING (bucket_id = 'company-assets'::text);

DROP POLICY IF EXISTS "rpc delete company-assets" ON storage.objects;
CREATE POLICY "rpc delete company-assets" ON storage.objects
  AS PERMISSIVE FOR DELETE TO anon, authenticated
  USING (bucket_id = 'company-assets'::text);

DROP POLICY IF EXISTS "rpc update company-assets" ON storage.objects;
CREATE POLICY "rpc update company-assets" ON storage.objects
  AS PERMISSIVE FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'company-assets'::text);

DROP POLICY IF EXISTS "rpc write company-assets" ON storage.objects;
CREATE POLICY "rpc write company-assets" ON storage.objects
  AS PERMISSIVE FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'company-assets'::text);

-- ---------- product-images ----------
DROP POLICY IF EXISTS "public read product-images" ON storage.objects;
CREATE POLICY "public read product-images" ON storage.objects
  AS PERMISSIVE FOR SELECT TO public
  USING (bucket_id = 'product-images'::text);

DROP POLICY IF EXISTS "rpc delete product-images" ON storage.objects;
CREATE POLICY "rpc delete product-images" ON storage.objects
  AS PERMISSIVE FOR DELETE TO anon, authenticated
  USING (bucket_id = 'product-images'::text);

DROP POLICY IF EXISTS "rpc update product-images" ON storage.objects;
CREATE POLICY "rpc update product-images" ON storage.objects
  AS PERMISSIVE FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'product-images'::text);

DROP POLICY IF EXISTS "rpc write product-images" ON storage.objects;
CREATE POLICY "rpc write product-images" ON storage.objects
  AS PERMISSIVE FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'product-images'::text);

DROP POLICY IF EXISTS "staff update product-images" ON storage.objects;
CREATE POLICY "staff update product-images" ON storage.objects
  AS PERMISSIVE FOR UPDATE TO public
  USING ((bucket_id = 'product-images'::text) AND (auth.role() = 'authenticated'::text));

-- ---------- invoice-documents (private) ----------
DROP POLICY IF EXISTS "staff read invoice-documents" ON storage.objects;
CREATE POLICY "staff read invoice-documents" ON storage.objects
  AS PERMISSIVE FOR SELECT TO public
  USING ((bucket_id = 'invoice-documents'::text) AND (auth.role() = 'authenticated'::text));

DROP POLICY IF EXISTS "staff write invoice-documents" ON storage.objects;
CREATE POLICY "staff write invoice-documents" ON storage.objects
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((bucket_id = 'invoice-documents'::text) AND (auth.role() = 'authenticated'::text));
