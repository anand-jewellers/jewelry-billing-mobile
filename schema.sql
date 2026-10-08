--
-- PostgreSQL database dump
--

\restrict 0gDcBRmSJ6hqnJtSdZx7eX5zJnQjoePV0SNHaw8HUpKP1N1fOXIEF8TK8dIfTsw

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: audit_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.audit_action AS ENUM (
    'insert',
    'update',
    'delete'
);


--
-- Name: calculation_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.calculation_type AS ENUM (
    'fixed',
    'per_gram',
    'percentage'
);


--
-- Name: invoice_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invoice_status AS ENUM (
    'draft',
    'unpaid',
    'partially_paid',
    'paid',
    'cancelled'
);


--
-- Name: metal_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.metal_type AS ENUM (
    'gold',
    'silver',
    'platinum',
    'other'
);


--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'ready',
    'completed'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'cash',
    'upi',
    'card',
    'bank_transfer',
    'cheque',
    'other'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'unpaid',
    'partially_paid',
    'paid'
);


--
-- Name: product_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.product_status AS ENUM (
    'active',
    'inactive',
    'sold'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'manager',
    'billing_staff'
);


--
-- Name: assert_staff_active(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_staff_active(p_staff_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_staff_id is null or not exists (
    select 1 from staff where id = p_staff_id and is_active = true
  ) then
    raise exception 'Invalid or inactive staff session' using errcode = '28000';
  end if;
end;
$$;


--
-- Name: assert_staff_is_admin_or_manager(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_staff_is_admin_or_manager(p_staff_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (
    select 1 from staff
    where id = p_staff_id and is_active = true and role = 'admin'
  ) then
    raise exception 'Insufficient privileges to set metal rate' using errcode = '42501';
  end if;
end;
$$;


--
-- Name: auth_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_role() RETURNS public.user_role
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role from profiles where id = auth.uid();
$$;


--
-- Name: calc_product_net_weight(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calc_product_net_weight() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.net_weight is null or new.net_weight = 0 then
    new.net_weight := greatest(new.gross_weight - new.stone_weight - new.other_weight, 0);
  end if;
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number text NOT NULL,
    customer_id uuid NOT NULL,
    invoice_date date DEFAULT CURRENT_DATE NOT NULL,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    invoice_discount numeric(12,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0 NOT NULL,
    grand_total numeric(14,2) DEFAULT 0 NOT NULL,
    paid_amount numeric(14,2) DEFAULT 0 NOT NULL,
    balance_amount numeric(14,2) DEFAULT 0 NOT NULL,
    payment_status public.payment_status DEFAULT 'unpaid'::public.payment_status NOT NULL,
    status public.invoice_status DEFAULT 'draft'::public.invoice_status NOT NULL,
    notes text,
    terms text,
    created_by uuid,
    cancelled_at timestamp with time zone,
    cancelled_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_mode character varying(100) DEFAULT 'cash'::text NOT NULL,
    exchange_total numeric DEFAULT 0 NOT NULL,
    remark text,
    CONSTRAINT invoices_payment_mode_not_empty CHECK ((length(TRIM(BOTH FROM payment_mode)) > 0))
);


--
-- Name: create_invoice_with_items(uuid, text, text, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, numeric, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_invoice_with_items(p_customer_id uuid, p_customer_name text, p_customer_mobile text, p_items jsonb, p_charges jsonb, p_subtotal numeric, p_invoice_discount numeric, p_tax_amount numeric, p_grand_total numeric, p_paid_amount numeric, p_balance_amount numeric, p_exchange_items jsonb DEFAULT '[]'::jsonb, p_exchange_total numeric DEFAULT 0, p_payment_mode text DEFAULT 'cash'::text, p_payment_splits jsonb DEFAULT '[]'::jsonb, p_remark text DEFAULT NULL::text) RETURNS public.invoices
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_customer_id      uuid := p_customer_id;
  v_invoice          invoices;
  v_invoice_id       uuid;
  v_item             jsonb;
  v_va               jsonb;
  v_charge           jsonb;
  v_exchange         jsonb;
  v_split            jsonb;
  v_invoice_item_id  uuid;
  v_status           invoice_status;
  v_payment_status   payment_status;
begin
  -- Resolve or create the customer (invoices.customer_id is NOT NULL)
  if v_customer_id is null then
    if p_customer_mobile is not null and length(trim(p_customer_mobile)) > 0 then
      select id into v_customer_id from customers where mobile = trim(p_customer_mobile) limit 1;
    end if;

    if v_customer_id is null then
      insert into customers (customer_code, name, mobile)
      values (
        'CUST-' || substr(gen_random_uuid()::text, 1, 8),
        coalesce(nullif(trim(p_customer_name), ''), 'Walk-in Customer'),
        nullif(trim(p_customer_mobile), '')
      )
      returning id into v_customer_id;
    end if;
  end if;

  if p_balance_amount <= 0 then
    v_payment_status := 'paid'::payment_status;
  elsif p_paid_amount > 0 or p_exchange_total > 0 then
    v_payment_status := 'partially_paid'::payment_status;
  else
    v_payment_status := 'unpaid'::payment_status;
  end if;

  if p_balance_amount <= 0 then
    v_status := 'paid'::invoice_status;
  elsif p_paid_amount > 0 or p_exchange_total > 0 then
    v_status := 'partially_paid'::invoice_status;
  else
    v_status := 'unpaid'::invoice_status;
  end if;

  insert into invoices (
    invoice_number, customer_id, subtotal, invoice_discount,
    tax_amount, grand_total, paid_amount, balance_amount,
    exchange_total, payment_mode,
    status, payment_status, remark
  )
  values (
    public.next_invoice_number(), v_customer_id, p_subtotal, p_invoice_discount,
    p_tax_amount, p_grand_total, p_paid_amount, p_balance_amount,
    coalesce(p_exchange_total, 0), coalesce(p_payment_mode, 'cash'),
    v_status, v_payment_status, nullif(trim(p_remark), '')
  )
  returning * into v_invoice;

  v_invoice_id := v_invoice.id;

  for v_charge in select * from jsonb_array_elements(coalesce(p_charges, '[]'::jsonb))
  loop
    insert into invoice_charges (invoice_id, charge_name, amount)
    values (v_invoice_id, v_charge->>'charge_name', (v_charge->>'amount')::numeric);
  end loop;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into invoice_items (
      invoice_id, product_id, product_name, product_code, metal_name, purity_name,
      quantity, gross_weight, stone_weight, net_weight, metal_rate, metal_value,
      making_charge_type, making_charge_value, making_charge_amount,
      value_added_total, discount, tax_amount, total
    )
    values (
      v_invoice_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      coalesce(nullif(v_item->>'product_code', ''), 'MANUAL'),
      v_item->>'metal_name',
      v_item->>'purity_name',
      coalesce((v_item->>'quantity')::numeric, 1),
      coalesce((v_item->>'gross_weight')::numeric, 0),
      coalesce((v_item->>'stone_weight')::numeric, 0),
      coalesce((v_item->>'net_weight')::numeric, 0),
      coalesce((v_item->>'metal_rate')::numeric, 0),
      coalesce((v_item->>'metal_value')::numeric, 0),
      (v_item->>'making_charge_type')::calculation_type,
      coalesce((v_item->>'making_charge_value')::numeric, 0),
      coalesce((v_item->>'making_charge_amount')::numeric, 0),
      coalesce((v_item->>'value_added_total')::numeric, 0),
      coalesce((v_item->>'discount')::numeric, 0),
      coalesce((v_item->>'tax_amount')::numeric, 0),
      coalesce((v_item->>'total')::numeric, 0)
    )
    returning id into v_invoice_item_id;

    for v_va in select * from jsonb_array_elements(coalesce(v_item->'value_added_charges', '[]'::jsonb))
    loop
      insert into invoice_item_value_added_charges (
        invoice_item_id, charge_name, calculation_type, value, amount
      )
      values (
        v_invoice_item_id,
        v_va->>'charge_name',
        (v_va->>'calculation_type')::calculation_type,
        coalesce((v_va->>'value')::numeric, 0),
        coalesce((v_va->>'amount')::numeric, 0)
      );
    end loop;
  end loop;

  for v_exchange in select * from jsonb_array_elements(coalesce(p_exchange_items, '[]'::jsonb))
  loop
    insert into invoice_exchange_items (
      invoice_id, description, gross_weight, stone_weight, purity_id, purity_percent,
      old_percent, deduction_percent, rate_per_gram, net_weight, amount
    )
    values (
      v_invoice_id,
      v_exchange->>'description',
      coalesce((v_exchange->>'gross_weight')::numeric, 0),
      coalesce((v_exchange->>'stone_weight')::numeric, 0),
      nullif(v_exchange->>'purity_id', '')::uuid,
      coalesce((v_exchange->>'purity_percent')::numeric, 0),
      coalesce((v_exchange->>'old_percent')::numeric, 0),
      coalesce((v_exchange->>'deduction_percent')::numeric, 0),
      coalesce((v_exchange->>'rate_per_gram')::numeric, 0),
      coalesce((v_exchange->>'net_weight')::numeric, 0),
      coalesce((v_exchange->>'amount')::numeric, 0)
    );
  end loop;

  for v_split in select * from jsonb_array_elements(coalesce(p_payment_splits, '[]'::jsonb))
  loop
    insert into invoice_payment_splits (
      invoice_id, payment_mode, amount, reference
    )
    values (
      v_invoice_id,
      v_split->>'payment_mode',
      coalesce((v_split->>'amount')::numeric, 0),
      nullif(v_split->>'reference', '')
    );
  end loop;

  update products
  set status = 'sold',
      updated_at = now()
  where id in (
    select (item->>'product_id')::uuid
    from jsonb_array_elements(p_items) as item
    where item->>'product_id' is not null and item->>'product_id' <> ''
  )
  and status <> 'sold';

  return v_invoice;
end;
$$;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_code text NOT NULL,
    product_name text NOT NULL,
    category_id uuid,
    subcategory_id uuid,
    brand text,
    description text,
    metal_id uuid NOT NULL,
    purity_id uuid NOT NULL,
    gross_weight numeric(10,3) NOT NULL,
    stone_weight numeric(10,3) DEFAULT 0 NOT NULL,
    other_weight numeric(10,3) DEFAULT 0 NOT NULL,
    net_weight numeric(10,3) DEFAULT 0 NOT NULL,
    metal_rate numeric(12,2) DEFAULT 0,
    metal_value numeric(14,2) DEFAULT 0,
    making_charge_type public.calculation_type DEFAULT 'per_gram'::public.calculation_type,
    making_charge_value numeric(12,2) DEFAULT 0,
    making_charge_amount numeric(14,2) DEFAULT 0,
    discount numeric(12,2) DEFAULT 0,
    selling_price numeric(14,2) DEFAULT 0,
    huid text,
    barcode text,
    sku text,
    design_number text,
    certification_number text,
    manufacturer text,
    supplier_name text,
    purchase_reference text,
    notes text,
    status public.product_status DEFAULT 'active'::public.product_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    qr_code_url text,
    gst_amount numeric,
    hsn_code text,
    gst_rate numeric,
    is_active boolean DEFAULT true NOT NULL,
    size text,
    tax_setting_id uuid,
    CONSTRAINT products_gross_weight_check CHECK ((gross_weight >= (0)::numeric)),
    CONSTRAINT products_net_weight_check CHECK ((net_weight >= (0)::numeric)),
    CONSTRAINT products_other_weight_check CHECK ((other_weight >= (0)::numeric)),
    CONSTRAINT products_stone_weight_check CHECK ((stone_weight >= (0)::numeric))
);


--
-- Name: create_product_rpc(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_product_rpc(p_staff_id uuid, p_product jsonb) RETURNS SETOF public.products
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_staff_active(p_staff_id);

  return query
  insert into products (
    product_name, category_id, subcategory_id, brand, metal_id, purity_id,
    gross_weight, stone_weight, other_weight, net_weight, metal_rate, metal_value,
    making_charge_type, making_charge_value, making_charge_amount, discount,
    hsn_code, gst_rate, gst_amount, selling_price, huid, design_number
  )
  values (
    p_product->>'product_name',
    nullif(p_product->>'category_id','')::uuid,
    nullif(p_product->>'subcategory_id','')::uuid,
    p_product->>'brand',
    (p_product->>'metal_id')::uuid,
    (p_product->>'purity_id')::uuid,
    (p_product->>'gross_weight')::numeric,
    (p_product->>'stone_weight')::numeric,
    (p_product->>'other_weight')::numeric,
    (p_product->>'net_weight')::numeric,
    (p_product->>'metal_rate')::numeric,
    (p_product->>'metal_value')::numeric,
    (p_product->>'making_charge_type')::calculation_type,
    (p_product->>'making_charge_value')::numeric,
    (p_product->>'making_charge_amount')::numeric,
    (p_product->>'discount')::numeric,
    p_product->>'hsn_code',
    (p_product->>'gst_rate')::numeric,
    (p_product->>'gst_amount')::numeric,
    (p_product->>'selling_price')::numeric,
    p_product->>'huid',
    p_product->>'design_number'
  )
  returning *;
end;
$$;


--
-- Name: create_staff_with_password(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_staff_with_password(p_name text, p_phone text, p_email text, p_role text, p_password text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare new_id uuid;
begin
  insert into staff (name, phone, email, role, password_hash)
  values (p_name, p_phone, p_email, p_role, crypt(p_password, gen_salt('bf')))
  returning id into new_id;

  if p_role = 'staff' then
    perform seed_staff_permissions(new_id);
  end if;

  return new_id;
end;
$$;


--
-- Name: delete_old_notifications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_old_notifications() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  delete from notifications
  where created_at < now() - interval '1 month';
$$;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_code text NOT NULL,
    name text NOT NULL,
    mobile text,
    email public.citext,
    address text,
    city text,
    state text,
    pincode text,
    gstin text,
    pan text,
    notes text,
    total_purchases numeric(14,2) DEFAULT 0 NOT NULL,
    outstanding_amount numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    phone text
);


--
-- Name: find_or_create_customer(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_or_create_customer(p_name text, p_phone text) RETURNS public.customers
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_customer customers;
begin
  if p_phone is not null and length(trim(p_phone)) > 0 then
    select * into v_customer from customers where phone = trim(p_phone) limit 1;
    if found then
      return v_customer;
    end if;
  end if;

  insert into customers (name, phone)
  values (trim(p_name), nullif(trim(p_phone), ''))
  returning * into v_customer;

  return v_customer;
end;
$$;


--
-- Name: generate_customer_order_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_customer_order_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.order_number is null then
    new.order_number := 'ORD-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  end if;
  return new;
end;
$$;


--
-- Name: handle_new_auth_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'billing_staff')
  );
  return new;
end;
$$;


--
-- Name: insert_product_images_rpc(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_product_images_rpc(p_staff_id uuid, p_images jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_staff_active(p_staff_id);

  insert into product_images (product_id, storage_path, is_primary, sort_order)
  select
    (elem->>'product_id')::uuid,
    elem->>'storage_path',
    (elem->>'is_primary')::boolean,
    (elem->>'sort_order')::int
  from jsonb_array_elements(p_images) elem;
end;
$$;


--
-- Name: insert_product_vac_rpc(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_product_vac_rpc(p_staff_id uuid, p_rows jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_staff_active(p_staff_id);

  insert into product_value_added_charges (product_id, charge_type_id, charge_name, calculation_type, value, amount)
  select
    (elem->>'product_id')::uuid,
    nullif(elem->>'charge_type_id','')::uuid,
    elem->>'charge_name',
    (elem->>'calculation_type')::calculation_type,
    (elem->>'value')::numeric,
    (elem->>'amount')::numeric
  from jsonb_array_elements(p_rows) elem;
end;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select auth_role() = 'admin';
$$;


--
-- Name: is_admin_or_manager(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin_or_manager() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select auth_role() in ('admin', 'manager');
$$;


--
-- Name: list_customers_rpc(text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_customers_rpc(p_search text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date) RETURNS TABLE(id uuid, name text, phone text, email text, address text, gstin text, latest_invoice_number text, latest_invoice_date date, latest_order_id uuid, latest_order_status text, latest_order_metal text)
    LANGUAGE sql STABLE
    AS $$
  select
    c.id, c.name, c.mobile as phone, c.email, c.address, c.gstin,
    li.invoice_number, li.invoice_date,
    lo.id, lo.status, lo.metal
  from customers c
  left join lateral (
    select i.invoice_number, i.invoice_date
    from invoices i
    where i.customer_id = c.id
      and (p_from is null or i.invoice_date >= p_from)
      and (p_to   is null or i.invoice_date <= p_to)
    order by i.invoice_date desc
    limit 1
  ) li on true
  left join lateral (
    select o.id, o.status, o.metal
    from customer_orders o
    where o.customer_id = c.id
    order by o.created_at desc
    limit 1
  ) lo on true
  where (p_search is null or p_search = ''
         or c.name ilike '%' || p_search || '%'
         or c.mobile ilike '%' || p_search || '%')
    and (
      (p_from is null and p_to is null)
      or li.invoice_number is not null
      or lo.status in ('pending','ready')
    );
$$;


--
-- Name: held_estimates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.held_estimates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    grand_total numeric DEFAULT 0 NOT NULL,
    data jsonb NOT NULL,
    billed_invoice_id text,
    billed_invoice_number text,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '04:00:00'::interval) NOT NULL
);


--
-- Name: list_held_estimates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_held_estimates() RETURNS SETOF public.held_estimates
    LANGUAGE plpgsql
    AS $$
begin
  delete from public.held_estimates where expires_at <= now();
  return query
    select * from public.held_estimates
    where expires_at > now()
    order by saved_at desc;
end;
$$;


--
-- Name: list_staff_with_permissions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_staff_with_permissions() RETURNS TABLE(id uuid, name text, phone text, email text, role text, is_active boolean, created_at timestamp with time zone, permissions jsonb)
    LANGUAGE sql STABLE
    AS $$
  select s.id, s.name, s.phone, s.email, s.role, s.is_active, s.created_at,
    coalesce(
      (select jsonb_agg(jsonb_build_object('page_key', sp.page_key, 'can_access', sp.can_access))
       from staff_permissions sp where sp.staff_id = s.id),
      '[]'::jsonb
    ) as permissions
  from staff s
  order by s.created_at asc;
$$;


--
-- Name: log_metal_rate_rpc(uuid, uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_metal_rate_rpc(p_staff_id uuid, p_metal_id uuid, p_purity_id uuid, p_rate numeric, p_source text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_source = 'manual' then
    perform assert_staff_is_admin_or_manager(p_staff_id);
  else
    perform assert_staff_active(p_staff_id);
  end if;

  insert into metal_rates (metal_id, purity_id, rate_per_gram, source, effective_date, effective_time)
  values (p_metal_id, p_purity_id, p_rate, p_source, current_date, current_time);
end;
$$;


--
-- Name: next_invoice_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_invoice_number() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  s public.invoice_settings%rowtype;
  v_scope text;
  v_seq bigint;
  v_now timestamp := now() at time zone 'Asia/Kolkata';
  v_len int;
  result text;
begin
  select * into s from public.invoice_settings where id = 1;

  -- restart numbering each year if the format contains {YYYY} or {YY}
  v_scope := case when s.invoice_number_format ~ '\{YY(YY)?\}'
                  then to_char(v_now, 'YYYY') else 'all' end;

  insert into public.invoice_counters(scope, last_seq)
  values (v_scope, s.starting_number)
  on conflict (scope) do update
    set last_seq = greatest(invoice_counters.last_seq + 1, s.starting_number)
  returning last_seq into v_seq;

  result := s.invoice_number_format;
  result := replace(result, '{PREFIX}', s.invoice_prefix);
  result := replace(result, '{YYYY}', to_char(v_now, 'YYYY'));
  result := replace(result, '{YY}',   to_char(v_now, 'YY'));
  result := replace(result, '{MM}',   to_char(v_now, 'MM'));

  v_len := coalesce(substring(result from '\{SEQ:(\d+)\}')::int, 0);
  result := regexp_replace(result, '\{SEQ(:\d+)?\}', lpad(v_seq::text, v_len, '0'));

  return result;
end;
$$;


--
-- Name: next_sequence_value(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_sequence_value(p_sequence_name text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_value bigint;
begin
  insert into sequence_counters (sequence_name, current_value)
  values (p_sequence_name, 1)
  on conflict (sequence_name)
  do update set current_value = sequence_counters.current_value + 1
  returning current_value into v_value;

  return v_value;
end;
$$;


--
-- Name: notify_pending_orders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_pending_orders() RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  c record;
  cnt int;
  list text;
begin
  -- remove earlier days' digests so old counts don't pile up
  delete from notifications
  where source = 'daily_digest'
    and (created_at at time zone 'Asia/Kolkata')::date < today;

  select count(*) into cnt
  from customer_orders
  where status = 'pending' and due_date is not null and due_date >= today;

  if cnt = 0 then return; end if;

  select string_agg(label, ', ' order by due_date, order_number) into list
  from (
    select order_number, due_date,
           order_number || ' (' ||
           case when due_date = today then 'due today'
                else 'due ' || to_char(due_date, 'DD Mon') end || ')' as label
    from customer_orders
    where status = 'pending' and due_date is not null and due_date >= today
    order by due_date, order_number
    limit 8
  ) t;

  if cnt > 8 then list := list || ' +' || (cnt - 8) || ' more'; end if;

  for c in select id from company_settings loop
    -- only digest rows count for the "already sent today" check
    if not exists (
      select 1 from notifications n
      where n.company_id = c.id
        and n.source = 'daily_digest'
        and (n.created_at at time zone 'Asia/Kolkata')::date = today
    ) then
      insert into notifications (company_id, type, title, message, created_by, source)
      values (
        c.id, 'order',
        cnt || ' jewel order' || case when cnt > 1 then 's' else '' end || ' pending',
        list, null, 'daily_digest'
      );
    end if;
  end loop;
end;
$$;


--
-- Name: save_held_estimate(uuid, text, numeric, jsonb, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_held_estimate(p_id uuid, p_label text, p_grand_total numeric, p_data jsonb, p_keep_expiry boolean DEFAULT false, p_billed_invoice_id text DEFAULT NULL::text, p_billed_invoice_number text DEFAULT NULL::text) RETURNS public.held_estimates
    LANGUAGE plpgsql
    AS $$
declare
  r public.held_estimates;
begin
  if p_id is not null and exists (select 1 from public.held_estimates where id = p_id) then
    update public.held_estimates
    set label                 = p_label,
        grand_total           = p_grand_total,
        data                  = p_data,
        billed_invoice_id     = coalesce(p_billed_invoice_id, billed_invoice_id),
        billed_invoice_number = coalesce(p_billed_invoice_number, billed_invoice_number),
        saved_at   = case when p_keep_expiry then saved_at   else now() end,
        expires_at = case when p_keep_expiry then expires_at else now() + interval '4 hours' end
    where id = p_id
    returning * into r;
  else
    insert into public.held_estimates
      (id, label, grand_total, data, billed_invoice_id, billed_invoice_number)
    values
      (coalesce(p_id, gen_random_uuid()), p_label, p_grand_total, p_data,
       p_billed_invoice_id, p_billed_invoice_number)
    returning * into r;
  end if;
  return r;
end;
$$;


--
-- Name: seed_staff_permissions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_staff_permissions(p_staff_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare k text;
begin
  for k in select unnest(array[
    'dashboard','products','invoices','customers','settings',
    'settings.company','settings.company_logo','settings.metals','settings.purity','settings.categories',
    'settings.gold_rates','settings.making_charges','settings.value_added_charges',
    'settings.tax','settings.invoice_settings','settings.staff'
  ])
  loop
    insert into staff_permissions (staff_id, page_key, can_access)
    values (p_staff_id, k, false)
    on conflict (staff_id, page_key) do nothing;
  end loop;
end;
$$;


--
-- Name: set_customer_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_customer_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.customer_code is null or new.customer_code = '' then
    new.customer_code := 'CUS-' || lpad(next_sequence_value('customer_code')::text, 6, '0');
  end if;
  return new;
end;
$$;


--
-- Name: set_invoice_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_invoice_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_prefix text;
  v_year   text := to_char(new.invoice_date, 'YYYY');
  v_seq    bigint;
begin
  if new.invoice_number is null or new.invoice_number = '' then
    select invoice_prefix into v_prefix from invoice_settings where id = 1;
    v_prefix := coalesce(v_prefix, 'INV');
    v_seq := next_sequence_value('invoice_number_' || v_year);
    new.invoice_number := v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  end if;
  return new;
end;
$$;


--
-- Name: set_product_barcode(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_product_barcode() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  new_barcode text;
  tries int := 0;
begin
  if new.barcode is not null then
    return new;
  end if;

  loop
    new_barcode := lpad((floor(random() * 100000000))::text, 8, '0');
    exit when not exists (select 1 from products where barcode = new_barcode);
    tries := tries + 1;
    if tries > 20 then
      raise exception 'Could not generate a unique barcode after % tries', tries;
    end if;
  end loop;

  new.barcode := new_barcode;
  return new;
end;
$$;


--
-- Name: set_product_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_product_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.product_code is null or new.product_code = '' then
    new.product_code := 'JWL-' || lpad(next_sequence_value('product_code')::text, 6, '0');
  end if;
  return new;
end;
$$;


--
-- Name: set_staff_password(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_staff_password(p_staff_id uuid, p_password text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  update staff set password_hash = crypt(p_password, gen_salt('bf')) where id = p_staff_id;
end;
$$;


--
-- Name: set_staff_permissions(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_staff_permissions(p_staff_id uuid, p_permissions jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  insert into staff_permissions (staff_id, page_key, can_access)
  select p_staff_id, (item->>'page_key')::text, (item->>'can_access')::boolean
  from jsonb_array_elements(p_permissions) as item
  on conflict (staff_id, page_key)
  do update set can_access = excluded.can_access;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: sync_customer_totals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_customer_totals() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_customer_id uuid := coalesce(new.customer_id, old.customer_id);
begin
  update customers
  set
    total_purchases = (
      select coalesce(sum(grand_total), 0) from invoices
      where customer_id = v_customer_id and status <> 'cancelled'
    ),
    outstanding_amount = (
      select coalesce(sum(balance_amount), 0) from invoices
      where customer_id = v_customer_id and status <> 'cancelled'
    )
  where id = v_customer_id;

  return coalesce(new, old);
end;
$$;


--
-- Name: sync_invoice_payment_totals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_invoice_payment_totals() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_invoice_id uuid;
  v_total_paid numeric(14,2);
  v_grand_total numeric(14,2);
begin
  v_invoice_id := coalesce(new.invoice_id, old.invoice_id);

  select coalesce(sum(amount), 0) into v_total_paid
  from payments where invoice_id = v_invoice_id;

  select grand_total into v_grand_total from invoices where id = v_invoice_id;

  update invoices
  set
    paid_amount = v_total_paid,
    balance_amount = greatest(v_grand_total - v_total_paid, 0),
    payment_status = case
      when v_total_paid <= 0 then 'unpaid'::payment_status
      when v_total_paid >= v_grand_total then 'paid'::payment_status
      else 'partially_paid'::payment_status
    end,
    status = case
      when status = 'cancelled' or status = 'draft' then status
      when v_total_paid <= 0 then 'unpaid'::invoice_status
      when v_total_paid >= v_grand_total then 'paid'::invoice_status
      else 'partially_paid'::invoice_status
    end
  where id = v_invoice_id;

  return coalesce(new, old);
end;
$$;


--
-- Name: update_product_qr_rpc(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_product_qr_rpc(p_staff_id uuid, p_product_id uuid, p_qr_url text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform assert_staff_active(p_staff_id);

  update products set qr_code_url = p_qr_url where id = p_product_id;
end;
$$;


--
-- Name: verify_staff_login(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_staff_login(p_email text, p_password text) RETURNS TABLE(id uuid, name text, role text, is_active boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  return query
  select s.id, s.name, s.role, s.is_active
  from staff s
  where s.email = p_email
    and s.password_hash is not null
    and s.password_hash = crypt(p_password, s.password_hash)
    and s.is_active = true;
end;
$$;


--
-- Name: verify_staff_password(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_staff_password(p_staff_id uuid, p_password text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  is_valid boolean;
begin
  select (s.password_hash is not null and s.password_hash = crypt(p_password, s.password_hash))
  into is_valid
  from staff s
  where s.id = p_staff_id;

  return coalesce(is_valid, false);
end;
$$;


--
-- Name: write_audit_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.write_audit_log() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (tg_op = 'DELETE') then
    insert into audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
    values (tg_table_name, old.id, 'delete', to_jsonb(old), null, auth.uid());
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
    values (tg_table_name, new.id, 'update', to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  elsif (tg_op = 'INSERT') then
    insert into audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
    values (tg_table_name, new.id, 'insert', null, to_jsonb(new), auth.uid());
    return new;
  end if;
  return null;
end;
$$;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    record_id uuid,
    action public.audit_action NOT NULL,
    old_data jsonb,
    new_data jsonb,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_settings (
    id integer DEFAULT 1 NOT NULL,
    company_name text DEFAULT ''::text NOT NULL,
    logo_url text,
    address text,
    city text,
    state text,
    pincode text,
    phone text,
    email text,
    gstin text,
    pan text,
    website text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_settings_singleton CHECK ((id = 1))
);


--
-- Name: metal_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metal_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    metal_id uuid NOT NULL,
    purity_id uuid NOT NULL,
    rate_per_gram numeric(12,2) NOT NULL,
    effective_date date DEFAULT CURRENT_DATE NOT NULL,
    effective_time time without time zone DEFAULT CURRENT_TIME NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    rate_date date DEFAULT CURRENT_DATE NOT NULL,
    CONSTRAINT metal_rates_rate_per_gram_check CHECK ((rate_per_gram >= (0)::numeric)),
    CONSTRAINT metal_rates_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'manual'::text])))
);


--
-- Name: current_metal_rates; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.current_metal_rates AS
 SELECT DISTINCT ON (metal_id, purity_id) id AS metal_rate_id,
    metal_id,
    purity_id,
    rate_per_gram,
    effective_date,
    effective_time,
    source,
    created_at
   FROM public.metal_rates
  ORDER BY metal_id, purity_id, effective_date DESC, effective_time DESC NULLS LAST, created_at DESC;


--
-- Name: customer_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    metal text NOT NULL,
    purity text NOT NULL,
    weight_min numeric NOT NULL,
    weight_max numeric NOT NULL,
    stone_weight numeric,
    stone_name text,
    notes text,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    category text,
    order_number text,
    invoice_id uuid,
    due_date date
);


--
-- Name: invoice_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    charge_name text NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invoice_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_counters (
    scope text NOT NULL,
    last_seq bigint NOT NULL
);


--
-- Name: invoice_exchange_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_exchange_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    description text NOT NULL,
    gross_weight numeric DEFAULT 0 NOT NULL,
    purity_percent numeric DEFAULT 0 NOT NULL,
    deduction_percent numeric DEFAULT 0 NOT NULL,
    rate_per_gram numeric DEFAULT 0 NOT NULL,
    net_weight numeric DEFAULT 0 NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stone_weight numeric DEFAULT 0 NOT NULL,
    purity_id uuid,
    old_percent numeric DEFAULT 0 NOT NULL
);


--
-- Name: invoice_item_value_added_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_item_value_added_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_item_id uuid NOT NULL,
    charge_name text NOT NULL,
    calculation_type public.calculation_type NOT NULL,
    value numeric(12,2) DEFAULT 0 NOT NULL,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    product_code text NOT NULL,
    metal_name text NOT NULL,
    purity_name text NOT NULL,
    quantity numeric(10,2) DEFAULT 1 NOT NULL,
    gross_weight numeric(10,3) DEFAULT 0 NOT NULL,
    stone_weight numeric(10,3) DEFAULT 0 NOT NULL,
    net_weight numeric(10,3) DEFAULT 0 NOT NULL,
    metal_rate numeric(12,2) DEFAULT 0 NOT NULL,
    metal_value numeric(14,2) DEFAULT 0 NOT NULL,
    making_charge_type public.calculation_type DEFAULT 'per_gram'::public.calculation_type NOT NULL,
    making_charge_value numeric(12,2) DEFAULT 0 NOT NULL,
    making_charge_amount numeric(14,2) DEFAULT 0 NOT NULL,
    value_added_total numeric(14,2) DEFAULT 0 NOT NULL,
    discount numeric(12,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_items_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: invoice_list_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.invoice_list_view WITH (security_invoker='true') AS
 SELECT i.id,
    i.invoice_number,
    i.invoice_date,
    i.grand_total,
    i.balance_amount,
    i.payment_status,
    i.payment_mode,
    i.status,
    i.created_at,
    COALESCE(c.name, 'Walk-in Customer'::text) AS customer_name
   FROM (public.invoices i
     LEFT JOIN public.customers c ON ((c.id = i.customer_id)));


--
-- Name: invoice_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_payment_splits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_payment_splits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    payment_mode text NOT NULL,
    amount numeric NOT NULL,
    reference text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_payment_splits_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: invoice_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_settings (
    id integer DEFAULT 1 NOT NULL,
    invoice_prefix text DEFAULT 'INV'::text NOT NULL,
    invoice_number_format text DEFAULT '{PREFIX}-{YYYY}-{SEQ:6}'::text NOT NULL,
    starting_number bigint DEFAULT 1 NOT NULL,
    invoice_footer text,
    terms_and_conditions text,
    show_logo boolean DEFAULT true NOT NULL,
    show_huid boolean DEFAULT true NOT NULL,
    show_weight boolean DEFAULT true NOT NULL,
    show_making_charges boolean DEFAULT true NOT NULL,
    show_value_added_charges boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_settings_singleton CHECK ((id = 1))
);


--
-- Name: making_charge_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.making_charge_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    metal_id uuid NOT NULL,
    purity_id uuid,
    category_id uuid,
    calculation_type public.calculation_type NOT NULL,
    value numeric(12,2) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT making_charge_rules_value_check CHECK ((value >= (0)::numeric))
);


--
-- Name: metals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    type public.metal_type DEFAULT 'other'::public.metal_type NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_dismissals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_dismissals (
    notification_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    dismissed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id integer NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source text,
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['product'::text, 'invoice'::text, 'settings'::text, 'order'::text])))
);


--
-- Name: panchangam_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.panchangam_days (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    tithi text,
    nakshatra text,
    good_times jsonb DEFAULT '[]'::jsonb NOT NULL,
    bad_times jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    amount numeric(14,2) NOT NULL,
    payment_method public.payment_method NOT NULL,
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    reference_number text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: product_diamonds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_diamonds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    size text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    storage_path text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_stones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_stones (
    product_id uuid NOT NULL,
    stone_id uuid NOT NULL,
    amount numeric DEFAULT 0 NOT NULL
);


--
-- Name: product_value_added_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_value_added_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    charge_type_id uuid,
    charge_name text NOT NULL,
    calculation_type public.calculation_type NOT NULL,
    value numeric(12,2) DEFAULT 0 NOT NULL,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    email public.citext NOT NULL,
    phone text,
    role public.user_role DEFAULT 'billing_staff'::public.user_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: purities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    metal_id uuid NOT NULL,
    name text NOT NULL,
    purity_percentage numeric(5,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sequence_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequence_counters (
    sequence_name text NOT NULL,
    current_value bigint DEFAULT 0 NOT NULL
);


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    role text DEFAULT 'staff'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    password_hash text
);


--
-- Name: staff_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    page_key text NOT NULL,
    can_access boolean DEFAULT true NOT NULL
);


--
-- Name: stones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subcategories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subcategories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tax_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tax_name text NOT NULL,
    tax_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    cgst numeric(5,2) DEFAULT 0 NOT NULL,
    sgst numeric(5,2) DEFAULT 0 NOT NULL,
    igst numeric(5,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: value_added_charge_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.value_added_charge_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    calculation_type public.calculation_type NOT NULL,
    default_value numeric(12,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: company_settings company_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_pkey PRIMARY KEY (id);


--
-- Name: customer_orders customer_orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_orders
    ADD CONSTRAINT customer_orders_order_number_key UNIQUE (order_number);


--
-- Name: customer_orders customer_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_orders
    ADD CONSTRAINT customer_orders_pkey PRIMARY KEY (id);


--
-- Name: customers customers_customer_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_customer_code_key UNIQUE (customer_code);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: held_estimates held_estimates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.held_estimates
    ADD CONSTRAINT held_estimates_pkey PRIMARY KEY (id);


--
-- Name: invoice_charges invoice_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_charges
    ADD CONSTRAINT invoice_charges_pkey PRIMARY KEY (id);


--
-- Name: invoice_counters invoice_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_counters
    ADD CONSTRAINT invoice_counters_pkey PRIMARY KEY (scope);


--
-- Name: invoice_exchange_items invoice_exchange_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_exchange_items
    ADD CONSTRAINT invoice_exchange_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_item_value_added_charges invoice_item_value_added_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_item_value_added_charges
    ADD CONSTRAINT invoice_item_value_added_charges_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_payment_splits invoice_payment_splits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payment_splits
    ADD CONSTRAINT invoice_payment_splits_pkey PRIMARY KEY (id);


--
-- Name: invoice_settings invoice_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_settings
    ADD CONSTRAINT invoice_settings_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: making_charge_rules making_charge_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.making_charge_rules
    ADD CONSTRAINT making_charge_rules_pkey PRIMARY KEY (id);


--
-- Name: metal_rates metal_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metal_rates
    ADD CONSTRAINT metal_rates_pkey PRIMARY KEY (id);


--
-- Name: metals metals_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metals
    ADD CONSTRAINT metals_code_key UNIQUE (code);


--
-- Name: metals metals_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metals
    ADD CONSTRAINT metals_name_key UNIQUE (name);


--
-- Name: metals metals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metals
    ADD CONSTRAINT metals_pkey PRIMARY KEY (id);


--
-- Name: notification_dismissals notification_dismissals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_dismissals
    ADD CONSTRAINT notification_dismissals_pkey PRIMARY KEY (notification_id, staff_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: panchangam_days panchangam_days_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.panchangam_days
    ADD CONSTRAINT panchangam_days_date_key UNIQUE (date);


--
-- Name: panchangam_days panchangam_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.panchangam_days
    ADD CONSTRAINT panchangam_days_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: product_diamonds product_diamonds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_diamonds
    ADD CONSTRAINT product_diamonds_pkey PRIMARY KEY (id);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: product_stones product_stones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stones
    ADD CONSTRAINT product_stones_pkey PRIMARY KEY (product_id, stone_id);


--
-- Name: product_value_added_charges product_value_added_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_value_added_charges
    ADD CONSTRAINT product_value_added_charges_pkey PRIMARY KEY (id);


--
-- Name: products products_barcode_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_barcode_key UNIQUE (barcode);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_product_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_product_code_key UNIQUE (product_code);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: purities purities_metal_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purities
    ADD CONSTRAINT purities_metal_id_name_key UNIQUE (metal_id, name);


--
-- Name: purities purities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purities
    ADD CONSTRAINT purities_pkey PRIMARY KEY (id);


--
-- Name: sequence_counters sequence_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_counters
    ADD CONSTRAINT sequence_counters_pkey PRIMARY KEY (sequence_name);


--
-- Name: staff staff_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_email_unique UNIQUE (email);


--
-- Name: staff_permissions staff_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_pkey PRIMARY KEY (id);


--
-- Name: staff_permissions staff_permissions_staff_id_page_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_staff_id_page_key_key UNIQUE (staff_id, page_key);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- Name: stones stones_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stones
    ADD CONSTRAINT stones_name_key UNIQUE (name);


--
-- Name: stones stones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stones
    ADD CONSTRAINT stones_pkey PRIMARY KEY (id);


--
-- Name: subcategories subcategories_category_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcategories
    ADD CONSTRAINT subcategories_category_id_name_key UNIQUE (category_id, name);


--
-- Name: subcategories subcategories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcategories
    ADD CONSTRAINT subcategories_pkey PRIMARY KEY (id);


--
-- Name: tax_settings tax_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_settings
    ADD CONSTRAINT tax_settings_pkey PRIMARY KEY (id);


--
-- Name: value_added_charge_types value_added_charge_types_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.value_added_charge_types
    ADD CONSTRAINT value_added_charge_types_name_key UNIQUE (name);


--
-- Name: value_added_charge_types value_added_charge_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.value_added_charge_types
    ADD CONSTRAINT value_added_charge_types_pkey PRIMARY KEY (id);


--
-- Name: held_estimates_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX held_estimates_expires_idx ON public.held_estimates USING btree (expires_at);


--
-- Name: idx_audit_logs_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_changed_at ON public.audit_logs USING btree (changed_at);


--
-- Name: idx_audit_logs_table_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_table_record ON public.audit_logs USING btree (table_name, record_id);


--
-- Name: idx_customer_orders_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_orders_customer_id ON public.customer_orders USING btree (customer_id);


--
-- Name: idx_customers_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_deleted_at ON public.customers USING btree (deleted_at);


--
-- Name: idx_customers_mobile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_mobile ON public.customers USING btree (mobile);


--
-- Name: idx_customers_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name_trgm ON public.customers USING gin (name public.gin_trgm_ops);


--
-- Name: idx_invoice_charges_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_charges_invoice_id ON public.invoice_charges USING btree (invoice_id);


--
-- Name: idx_invoice_item_vac_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_item_vac_item_id ON public.invoice_item_value_added_charges USING btree (invoice_item_id);


--
-- Name: idx_invoice_items_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_items_invoice_id ON public.invoice_items USING btree (invoice_id);


--
-- Name: idx_invoice_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_items_product_id ON public.invoice_items USING btree (product_id);


--
-- Name: idx_invoice_payment_splits_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_payment_splits_invoice_id ON public.invoice_payment_splits USING btree (invoice_id);


--
-- Name: idx_invoices_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_created_at ON public.invoices USING btree (created_at DESC);


--
-- Name: idx_invoices_customer_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_customer_date ON public.invoices USING btree (customer_id, invoice_date DESC);


--
-- Name: idx_invoices_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_customer_id ON public.invoices USING btree (customer_id);


--
-- Name: idx_invoices_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_date ON public.invoices USING btree (invoice_date);


--
-- Name: idx_invoices_invoice_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_invoice_date ON public.invoices USING btree (invoice_date);


--
-- Name: idx_invoices_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_number_trgm ON public.invoices USING gin (invoice_number public.gin_trgm_ops);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_making_charge_rules_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_making_charge_rules_lookup ON public.making_charge_rules USING btree (metal_id, purity_id, category_id);


--
-- Name: idx_metal_rates_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metal_rates_lookup ON public.metal_rates USING btree (metal_id, purity_id, effective_date DESC, effective_time DESC);


--
-- Name: idx_orders_customer_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_created ON public.customer_orders USING btree (customer_id, created_at DESC);


--
-- Name: idx_payments_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_invoice_id ON public.payments USING btree (invoice_id);


--
-- Name: idx_product_images_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_images_product_id ON public.product_images USING btree (product_id);


--
-- Name: idx_product_stones_stone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_stones_stone ON public.product_stones USING btree (stone_id);


--
-- Name: idx_product_vac_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_vac_product_id ON public.product_value_added_charges USING btree (product_id);


--
-- Name: idx_products_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_barcode ON public.products USING btree (barcode);


--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category ON public.products USING btree (category_id);


--
-- Name: idx_products_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_deleted_at ON public.products USING btree (deleted_at);


--
-- Name: idx_products_metal_purity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_metal_purity ON public.products USING btree (metal_id, purity_id);


--
-- Name: idx_products_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name_trgm ON public.products USING gin (product_name public.gin_trgm_ops);


--
-- Name: idx_products_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_sku ON public.products USING btree (sku);


--
-- Name: idx_products_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_status ON public.products USING btree (status);


--
-- Name: idx_purities_metal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purities_metal_id ON public.purities USING btree (metal_id);


--
-- Name: idx_subcategories_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subcategories_category_id ON public.subcategories USING btree (category_id);


--
-- Name: invoice_exchange_items_invoice_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_exchange_items_invoice_id_idx ON public.invoice_exchange_items USING btree (invoice_id);


--
-- Name: notifications_company_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_company_created_idx ON public.notifications USING btree (company_id, created_at DESC);


--
-- Name: panchangam_days_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX panchangam_days_date_idx ON public.panchangam_days USING btree (date);


--
-- Name: company_settings trg_company_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_company_settings_updated_at BEFORE UPDATE ON public.company_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customer_orders trg_customer_orders_order_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customer_orders_order_number BEFORE INSERT ON public.customer_orders FOR EACH ROW EXECUTE FUNCTION public.generate_customer_order_number();


--
-- Name: customer_orders trg_customer_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customer_orders_updated_at BEFORE UPDATE ON public.customer_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customers trg_customers_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_audit AFTER INSERT OR DELETE OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();


--
-- Name: customers trg_customers_set_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_set_code BEFORE INSERT ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_customer_code();


--
-- Name: customers trg_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: invoice_settings trg_invoice_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_invoice_settings_updated_at BEFORE UPDATE ON public.invoice_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: invoices trg_invoices_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_invoices_audit AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();


--
-- Name: invoices trg_invoices_set_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_invoices_set_number BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_invoice_number();


--
-- Name: invoices trg_invoices_sync_customer; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_invoices_sync_customer AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.sync_customer_totals();


--
-- Name: invoices trg_invoices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: making_charge_rules trg_making_charge_rules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_making_charge_rules_updated_at BEFORE UPDATE ON public.making_charge_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: metal_rates trg_metal_rates_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_metal_rates_audit AFTER INSERT OR DELETE OR UPDATE ON public.metal_rates FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();


--
-- Name: payments trg_payments_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payments_audit AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();


--
-- Name: payments trg_payments_sync_invoice; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payments_sync_invoice AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_payment_totals();


--
-- Name: products trg_products_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_audit AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();


--
-- Name: products trg_products_net_weight; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_net_weight BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.calc_product_net_weight();


--
-- Name: products trg_products_set_barcode; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_set_barcode BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_product_barcode();


--
-- Name: products trg_products_set_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_set_code BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_product_code();


--
-- Name: products trg_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tax_settings trg_tax_settings_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tax_settings_audit AFTER INSERT OR DELETE OR UPDATE ON public.tax_settings FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();


--
-- Name: tax_settings trg_tax_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tax_settings_updated_at BEFORE UPDATE ON public.tax_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: value_added_charge_types trg_vac_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_vac_types_updated_at BEFORE UPDATE ON public.value_added_charge_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_logs audit_logs_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.profiles(id);


--
-- Name: customer_orders customer_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_orders
    ADD CONSTRAINT customer_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_orders customer_orders_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_orders
    ADD CONSTRAINT customer_orders_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: invoice_charges invoice_charges_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_charges
    ADD CONSTRAINT invoice_charges_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_exchange_items invoice_exchange_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_exchange_items
    ADD CONSTRAINT invoice_exchange_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_exchange_items invoice_exchange_items_purity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_exchange_items
    ADD CONSTRAINT invoice_exchange_items_purity_id_fkey FOREIGN KEY (purity_id) REFERENCES public.purities(id);


--
-- Name: invoice_item_value_added_charges invoice_item_value_added_charges_invoice_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_item_value_added_charges
    ADD CONSTRAINT invoice_item_value_added_charges_invoice_item_id_fkey FOREIGN KEY (invoice_item_id) REFERENCES public.invoice_items(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: invoice_payment_splits invoice_payment_splits_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payment_splits
    ADD CONSTRAINT invoice_payment_splits_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: invoices invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;


--
-- Name: making_charge_rules making_charge_rules_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.making_charge_rules
    ADD CONSTRAINT making_charge_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: making_charge_rules making_charge_rules_metal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.making_charge_rules
    ADD CONSTRAINT making_charge_rules_metal_id_fkey FOREIGN KEY (metal_id) REFERENCES public.metals(id) ON DELETE RESTRICT;


--
-- Name: making_charge_rules making_charge_rules_purity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.making_charge_rules
    ADD CONSTRAINT making_charge_rules_purity_id_fkey FOREIGN KEY (purity_id) REFERENCES public.purities(id) ON DELETE RESTRICT;


--
-- Name: metal_rates metal_rates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metal_rates
    ADD CONSTRAINT metal_rates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: metal_rates metal_rates_metal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metal_rates
    ADD CONSTRAINT metal_rates_metal_id_fkey FOREIGN KEY (metal_id) REFERENCES public.metals(id) ON DELETE RESTRICT;


--
-- Name: metal_rates metal_rates_purity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metal_rates
    ADD CONSTRAINT metal_rates_purity_id_fkey FOREIGN KEY (purity_id) REFERENCES public.purities(id) ON DELETE RESTRICT;


--
-- Name: notification_dismissals notification_dismissals_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_dismissals
    ADD CONSTRAINT notification_dismissals_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: notification_dismissals notification_dismissals_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_dismissals
    ADD CONSTRAINT notification_dismissals_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company_settings(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: payments payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: product_diamonds product_diamonds_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_diamonds
    ADD CONSTRAINT product_diamonds_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_stones product_stones_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stones
    ADD CONSTRAINT product_stones_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_stones product_stones_stone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stones
    ADD CONSTRAINT product_stones_stone_id_fkey FOREIGN KEY (stone_id) REFERENCES public.stones(id) ON DELETE RESTRICT;


--
-- Name: product_value_added_charges product_value_added_charges_charge_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_value_added_charges
    ADD CONSTRAINT product_value_added_charges_charge_type_id_fkey FOREIGN KEY (charge_type_id) REFERENCES public.value_added_charge_types(id) ON DELETE SET NULL;


--
-- Name: product_value_added_charges product_value_added_charges_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_value_added_charges
    ADD CONSTRAINT product_value_added_charges_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: products products_metal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_metal_id_fkey FOREIGN KEY (metal_id) REFERENCES public.metals(id) ON DELETE RESTRICT;


--
-- Name: products products_purity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_purity_id_fkey FOREIGN KEY (purity_id) REFERENCES public.purities(id) ON DELETE RESTRICT;


--
-- Name: products products_subcategory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_subcategory_id_fkey FOREIGN KEY (subcategory_id) REFERENCES public.subcategories(id) ON DELETE SET NULL;


--
-- Name: products products_tax_setting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tax_setting_id_fkey FOREIGN KEY (tax_setting_id) REFERENCES public.tax_settings(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: purities purities_metal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purities
    ADD CONSTRAINT purities_metal_id_fkey FOREIGN KEY (metal_id) REFERENCES public.metals(id) ON DELETE RESTRICT;


--
-- Name: staff_permissions staff_permissions_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_permissions
    ADD CONSTRAINT staff_permissions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: subcategories subcategories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subcategories
    ADD CONSTRAINT subcategories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: invoice_payment_splits Allow read access to invoice_payment_splits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read access to invoice_payment_splits" ON public.invoice_payment_splits FOR SELECT USING (true);


--
-- Name: panchangam_days Allow read access to panchangam_days; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read access to panchangam_days" ON public.panchangam_days FOR SELECT TO authenticated, anon USING (true);


--
-- Name: company_settings anyone can read company settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anyone can read company settings" ON public.company_settings FOR SELECT TO authenticated, anon USING (true);


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_logs read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "audit_logs read" ON public.audit_logs FOR SELECT TO authenticated, anon USING (true);


--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories categories read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "categories read" ON public.categories FOR SELECT TO authenticated, anon USING (true);


--
-- Name: categories categories write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "categories write" ON public.categories TO authenticated, anon USING (true);


--
-- Name: company_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_orders customer_orders insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "customer_orders insert" ON public.customer_orders FOR INSERT WITH CHECK (true);


--
-- Name: customer_orders customer_orders read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "customer_orders read" ON public.customer_orders FOR SELECT USING (true);


--
-- Name: customer_orders customer_orders update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "customer_orders update" ON public.customer_orders FOR UPDATE USING (true);


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "customers insert" ON public.customers FOR INSERT WITH CHECK (true);


--
-- Name: customers customers read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "customers read" ON public.customers FOR SELECT TO authenticated, anon USING (true);


--
-- Name: customers customers update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "customers update" ON public.customers FOR UPDATE TO authenticated, anon USING (true);


--
-- Name: held_estimates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.held_estimates ENABLE ROW LEVEL SECURITY;

--
-- Name: held_estimates held_estimates_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY held_estimates_all ON public.held_estimates TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: invoice_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_charges invoice_charges read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoice_charges read" ON public.invoice_charges FOR SELECT TO authenticated, anon USING (true);


--
-- Name: invoice_charges invoice_charges write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoice_charges write" ON public.invoice_charges TO authenticated, anon USING (true);


--
-- Name: invoice_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_exchange_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_exchange_items ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_exchange_items invoice_exchange_items_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoice_exchange_items_read ON public.invoice_exchange_items FOR SELECT TO authenticated, anon USING (true);


--
-- Name: invoice_exchange_items invoice_exchange_items_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoice_exchange_items_write ON public.invoice_exchange_items TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: invoice_item_value_added_charges invoice_item_vac read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoice_item_vac read" ON public.invoice_item_value_added_charges FOR SELECT TO authenticated, anon USING (true);


--
-- Name: invoice_item_value_added_charges invoice_item_vac write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoice_item_vac write" ON public.invoice_item_value_added_charges TO authenticated, anon USING (true);


--
-- Name: invoice_item_value_added_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_item_value_added_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_items invoice_items read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoice_items read" ON public.invoice_items FOR SELECT TO authenticated, anon USING (true);


--
-- Name: invoice_items invoice_items write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoice_items write" ON public.invoice_items TO authenticated, anon USING (true);


--
-- Name: invoice_payment_splits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_payment_splits ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_settings invoice_settings read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoice_settings read" ON public.invoice_settings FOR SELECT TO authenticated, anon USING (true);


--
-- Name: invoice_settings invoice_settings write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoice_settings write" ON public.invoice_settings TO authenticated, anon USING (true);


--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices invoices insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoices insert" ON public.invoices FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: invoices invoices read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoices read" ON public.invoices FOR SELECT TO authenticated, anon USING (true);


--
-- Name: invoices invoices update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invoices update" ON public.invoices FOR UPDATE TO authenticated, anon USING (true);


--
-- Name: making_charge_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.making_charge_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: making_charge_rules making_charge_rules read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "making_charge_rules read" ON public.making_charge_rules FOR SELECT TO authenticated, anon USING (true);


--
-- Name: making_charge_rules making_charge_rules write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "making_charge_rules write" ON public.making_charge_rules TO authenticated, anon USING (true);


--
-- Name: metal_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metal_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: metal_rates metal_rates delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "metal_rates delete" ON public.metal_rates FOR DELETE TO authenticated, anon USING (true);


--
-- Name: metal_rates metal_rates read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "metal_rates read" ON public.metal_rates FOR SELECT TO authenticated, anon USING (true);


--
-- Name: metal_rates metal_rates update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "metal_rates update" ON public.metal_rates FOR UPDATE TO authenticated, anon USING (true);


--
-- Name: metals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metals ENABLE ROW LEVEL SECURITY;

--
-- Name: metals metals read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "metals read" ON public.metals FOR SELECT TO authenticated, anon USING (true);


--
-- Name: metals metals write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "metals write" ON public.metals TO authenticated, anon USING (true);


--
-- Name: notification_dismissals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_dismissals ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_dismissals notification_dismissals_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_dismissals_rw ON public.notification_dismissals USING (true) WITH CHECK (true);


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_rw ON public.notifications USING (true) WITH CHECK (true);


--
-- Name: panchangam_days; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.panchangam_days ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payments payments delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "payments delete" ON public.payments FOR DELETE TO authenticated, anon USING (true);


--
-- Name: payments payments insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "payments insert" ON public.payments FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: payments payments read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "payments read" ON public.payments FOR SELECT TO authenticated, anon USING (true);


--
-- Name: product_diamonds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_diamonds ENABLE ROW LEVEL SECURITY;

--
-- Name: product_diamonds product_diamonds all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "product_diamonds all" ON public.product_diamonds USING (true) WITH CHECK (true);


--
-- Name: product_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

--
-- Name: product_images product_images read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "product_images read" ON public.product_images FOR SELECT TO authenticated, anon USING (true);


--
-- Name: product_images product_images write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "product_images write" ON public.product_images TO authenticated, anon USING (true);


--
-- Name: product_stones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_stones ENABLE ROW LEVEL SECURITY;

--
-- Name: product_stones product_stones read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "product_stones read" ON public.product_stones FOR SELECT TO authenticated, anon USING (true);


--
-- Name: product_stones product_stones write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "product_stones write" ON public.product_stones TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: product_value_added_charges product_vac read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "product_vac read" ON public.product_value_added_charges FOR SELECT TO authenticated, anon USING (true);


--
-- Name: product_value_added_charges product_vac write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "product_vac write" ON public.product_value_added_charges TO authenticated, anon USING (true);


--
-- Name: product_value_added_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_value_added_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "products delete" ON public.products FOR DELETE TO authenticated, anon USING (true);


--
-- Name: products products read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "products read" ON public.products FOR SELECT TO authenticated, anon USING (true);


--
-- Name: products products update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "products update" ON public.products FOR UPDATE TO authenticated, anon USING (true);


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles admin manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles admin manage" ON public.profiles USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: profiles profiles self read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles self read" ON public.profiles FOR SELECT USING (((id = auth.uid()) OR public.is_admin_or_manager()));


--
-- Name: profiles profiles self update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: purities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purities ENABLE ROW LEVEL SECURITY;

--
-- Name: purities purities read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "purities read" ON public.purities FOR SELECT TO authenticated, anon USING (true);


--
-- Name: purities purities write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "purities write" ON public.purities TO authenticated, anon USING (true);


--
-- Name: metal_rates rpc insert metal_rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "rpc insert metal_rates" ON public.metal_rates FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: products rpc insert products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "rpc insert products" ON public.products FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: sequence_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sequence_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: company_settings settings write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "settings write" ON public.company_settings TO authenticated, anon USING (true);


--
-- Name: staff; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

--
-- Name: staff staff full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff full access" ON public.staff TO authenticated, anon USING (true);


--
-- Name: staff_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_permissions staff_permissions full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff_permissions full access" ON public.staff_permissions TO authenticated, anon USING (true);


--
-- Name: stones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stones ENABLE ROW LEVEL SECURITY;

--
-- Name: stones stones read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stones read" ON public.stones FOR SELECT TO authenticated, anon USING (true);


--
-- Name: stones stones write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stones write" ON public.stones TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: subcategories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;

--
-- Name: subcategories subcategories read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "subcategories read" ON public.subcategories FOR SELECT TO authenticated, anon USING (true);


--
-- Name: subcategories subcategories write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "subcategories write" ON public.subcategories TO authenticated, anon USING (true);


--
-- Name: tax_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_settings tax_settings read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tax_settings read" ON public.tax_settings FOR SELECT TO authenticated, anon USING (true);


--
-- Name: tax_settings tax_settings write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tax_settings write" ON public.tax_settings TO authenticated, anon USING (true);


--
-- Name: value_added_charge_types vac_types read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vac_types read" ON public.value_added_charge_types FOR SELECT TO authenticated, anon USING (true);


--
-- Name: value_added_charge_types vac_types write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vac_types write" ON public.value_added_charge_types TO authenticated, anon USING (true);


--
-- Name: value_added_charge_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.value_added_charge_types ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION assert_staff_active(p_staff_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.assert_staff_active(p_staff_id uuid) TO anon;
GRANT ALL ON FUNCTION public.assert_staff_active(p_staff_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.assert_staff_active(p_staff_id uuid) TO service_role;


--
-- Name: FUNCTION assert_staff_is_admin_or_manager(p_staff_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.assert_staff_is_admin_or_manager(p_staff_id uuid) TO anon;
GRANT ALL ON FUNCTION public.assert_staff_is_admin_or_manager(p_staff_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.assert_staff_is_admin_or_manager(p_staff_id uuid) TO service_role;


--
-- Name: FUNCTION auth_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.auth_role() TO anon;
GRANT ALL ON FUNCTION public.auth_role() TO authenticated;
GRANT ALL ON FUNCTION public.auth_role() TO service_role;


--
-- Name: FUNCTION calc_product_net_weight(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calc_product_net_weight() TO anon;
GRANT ALL ON FUNCTION public.calc_product_net_weight() TO authenticated;
GRANT ALL ON FUNCTION public.calc_product_net_weight() TO service_role;


--
-- Name: TABLE invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoices TO anon;
GRANT ALL ON TABLE public.invoices TO authenticated;
GRANT ALL ON TABLE public.invoices TO service_role;


--
-- Name: FUNCTION create_invoice_with_items(p_customer_id uuid, p_customer_name text, p_customer_mobile text, p_items jsonb, p_charges jsonb, p_subtotal numeric, p_invoice_discount numeric, p_tax_amount numeric, p_grand_total numeric, p_paid_amount numeric, p_balance_amount numeric, p_exchange_items jsonb, p_exchange_total numeric, p_payment_mode text, p_payment_splits jsonb, p_remark text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_invoice_with_items(p_customer_id uuid, p_customer_name text, p_customer_mobile text, p_items jsonb, p_charges jsonb, p_subtotal numeric, p_invoice_discount numeric, p_tax_amount numeric, p_grand_total numeric, p_paid_amount numeric, p_balance_amount numeric, p_exchange_items jsonb, p_exchange_total numeric, p_payment_mode text, p_payment_splits jsonb, p_remark text) TO anon;
GRANT ALL ON FUNCTION public.create_invoice_with_items(p_customer_id uuid, p_customer_name text, p_customer_mobile text, p_items jsonb, p_charges jsonb, p_subtotal numeric, p_invoice_discount numeric, p_tax_amount numeric, p_grand_total numeric, p_paid_amount numeric, p_balance_amount numeric, p_exchange_items jsonb, p_exchange_total numeric, p_payment_mode text, p_payment_splits jsonb, p_remark text) TO authenticated;
GRANT ALL ON FUNCTION public.create_invoice_with_items(p_customer_id uuid, p_customer_name text, p_customer_mobile text, p_items jsonb, p_charges jsonb, p_subtotal numeric, p_invoice_discount numeric, p_tax_amount numeric, p_grand_total numeric, p_paid_amount numeric, p_balance_amount numeric, p_exchange_items jsonb, p_exchange_total numeric, p_payment_mode text, p_payment_splits jsonb, p_remark text) TO service_role;


--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.products TO anon;
GRANT ALL ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;


--
-- Name: FUNCTION create_product_rpc(p_staff_id uuid, p_product jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_product_rpc(p_staff_id uuid, p_product jsonb) TO anon;
GRANT ALL ON FUNCTION public.create_product_rpc(p_staff_id uuid, p_product jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.create_product_rpc(p_staff_id uuid, p_product jsonb) TO service_role;


--
-- Name: FUNCTION create_staff_with_password(p_name text, p_phone text, p_email text, p_role text, p_password text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_staff_with_password(p_name text, p_phone text, p_email text, p_role text, p_password text) TO anon;
GRANT ALL ON FUNCTION public.create_staff_with_password(p_name text, p_phone text, p_email text, p_role text, p_password text) TO authenticated;
GRANT ALL ON FUNCTION public.create_staff_with_password(p_name text, p_phone text, p_email text, p_role text, p_password text) TO service_role;


--
-- Name: FUNCTION delete_old_notifications(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.delete_old_notifications() TO anon;
GRANT ALL ON FUNCTION public.delete_old_notifications() TO authenticated;
GRANT ALL ON FUNCTION public.delete_old_notifications() TO service_role;


--
-- Name: TABLE customers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customers TO anon;
GRANT ALL ON TABLE public.customers TO authenticated;
GRANT ALL ON TABLE public.customers TO service_role;


--
-- Name: FUNCTION find_or_create_customer(p_name text, p_phone text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.find_or_create_customer(p_name text, p_phone text) TO anon;
GRANT ALL ON FUNCTION public.find_or_create_customer(p_name text, p_phone text) TO authenticated;
GRANT ALL ON FUNCTION public.find_or_create_customer(p_name text, p_phone text) TO service_role;


--
-- Name: FUNCTION generate_customer_order_number(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.generate_customer_order_number() TO anon;
GRANT ALL ON FUNCTION public.generate_customer_order_number() TO authenticated;
GRANT ALL ON FUNCTION public.generate_customer_order_number() TO service_role;


--
-- Name: FUNCTION handle_new_auth_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_auth_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_auth_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_auth_user() TO service_role;


--
-- Name: FUNCTION insert_product_images_rpc(p_staff_id uuid, p_images jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.insert_product_images_rpc(p_staff_id uuid, p_images jsonb) TO anon;
GRANT ALL ON FUNCTION public.insert_product_images_rpc(p_staff_id uuid, p_images jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.insert_product_images_rpc(p_staff_id uuid, p_images jsonb) TO service_role;


--
-- Name: FUNCTION insert_product_vac_rpc(p_staff_id uuid, p_rows jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.insert_product_vac_rpc(p_staff_id uuid, p_rows jsonb) TO anon;
GRANT ALL ON FUNCTION public.insert_product_vac_rpc(p_staff_id uuid, p_rows jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.insert_product_vac_rpc(p_staff_id uuid, p_rows jsonb) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_admin_or_manager(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin_or_manager() TO anon;
GRANT ALL ON FUNCTION public.is_admin_or_manager() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin_or_manager() TO service_role;


--
-- Name: FUNCTION list_customers_rpc(p_search text, p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.list_customers_rpc(p_search text, p_from date, p_to date) TO anon;
GRANT ALL ON FUNCTION public.list_customers_rpc(p_search text, p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.list_customers_rpc(p_search text, p_from date, p_to date) TO service_role;


--
-- Name: TABLE held_estimates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.held_estimates TO anon;
GRANT ALL ON TABLE public.held_estimates TO authenticated;
GRANT ALL ON TABLE public.held_estimates TO service_role;


--
-- Name: FUNCTION list_held_estimates(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.list_held_estimates() TO anon;
GRANT ALL ON FUNCTION public.list_held_estimates() TO authenticated;
GRANT ALL ON FUNCTION public.list_held_estimates() TO service_role;


--
-- Name: FUNCTION list_staff_with_permissions(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.list_staff_with_permissions() TO anon;
GRANT ALL ON FUNCTION public.list_staff_with_permissions() TO authenticated;
GRANT ALL ON FUNCTION public.list_staff_with_permissions() TO service_role;


--
-- Name: FUNCTION log_metal_rate_rpc(p_staff_id uuid, p_metal_id uuid, p_purity_id uuid, p_rate numeric, p_source text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.log_metal_rate_rpc(p_staff_id uuid, p_metal_id uuid, p_purity_id uuid, p_rate numeric, p_source text) TO anon;
GRANT ALL ON FUNCTION public.log_metal_rate_rpc(p_staff_id uuid, p_metal_id uuid, p_purity_id uuid, p_rate numeric, p_source text) TO authenticated;
GRANT ALL ON FUNCTION public.log_metal_rate_rpc(p_staff_id uuid, p_metal_id uuid, p_purity_id uuid, p_rate numeric, p_source text) TO service_role;


--
-- Name: FUNCTION next_invoice_number(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.next_invoice_number() TO anon;
GRANT ALL ON FUNCTION public.next_invoice_number() TO authenticated;
GRANT ALL ON FUNCTION public.next_invoice_number() TO service_role;


--
-- Name: FUNCTION next_sequence_value(p_sequence_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.next_sequence_value(p_sequence_name text) TO anon;
GRANT ALL ON FUNCTION public.next_sequence_value(p_sequence_name text) TO authenticated;
GRANT ALL ON FUNCTION public.next_sequence_value(p_sequence_name text) TO service_role;


--
-- Name: FUNCTION notify_pending_orders(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_pending_orders() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_pending_orders() TO service_role;


--
-- Name: FUNCTION save_held_estimate(p_id uuid, p_label text, p_grand_total numeric, p_data jsonb, p_keep_expiry boolean, p_billed_invoice_id text, p_billed_invoice_number text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.save_held_estimate(p_id uuid, p_label text, p_grand_total numeric, p_data jsonb, p_keep_expiry boolean, p_billed_invoice_id text, p_billed_invoice_number text) TO anon;
GRANT ALL ON FUNCTION public.save_held_estimate(p_id uuid, p_label text, p_grand_total numeric, p_data jsonb, p_keep_expiry boolean, p_billed_invoice_id text, p_billed_invoice_number text) TO authenticated;
GRANT ALL ON FUNCTION public.save_held_estimate(p_id uuid, p_label text, p_grand_total numeric, p_data jsonb, p_keep_expiry boolean, p_billed_invoice_id text, p_billed_invoice_number text) TO service_role;


--
-- Name: FUNCTION seed_staff_permissions(p_staff_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.seed_staff_permissions(p_staff_id uuid) TO anon;
GRANT ALL ON FUNCTION public.seed_staff_permissions(p_staff_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.seed_staff_permissions(p_staff_id uuid) TO service_role;


--
-- Name: FUNCTION set_customer_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_customer_code() TO anon;
GRANT ALL ON FUNCTION public.set_customer_code() TO authenticated;
GRANT ALL ON FUNCTION public.set_customer_code() TO service_role;


--
-- Name: FUNCTION set_invoice_number(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_invoice_number() TO anon;
GRANT ALL ON FUNCTION public.set_invoice_number() TO authenticated;
GRANT ALL ON FUNCTION public.set_invoice_number() TO service_role;


--
-- Name: FUNCTION set_product_barcode(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_product_barcode() TO anon;
GRANT ALL ON FUNCTION public.set_product_barcode() TO authenticated;
GRANT ALL ON FUNCTION public.set_product_barcode() TO service_role;


--
-- Name: FUNCTION set_product_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_product_code() TO anon;
GRANT ALL ON FUNCTION public.set_product_code() TO authenticated;
GRANT ALL ON FUNCTION public.set_product_code() TO service_role;


--
-- Name: FUNCTION set_staff_password(p_staff_id uuid, p_password text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_staff_password(p_staff_id uuid, p_password text) TO anon;
GRANT ALL ON FUNCTION public.set_staff_password(p_staff_id uuid, p_password text) TO authenticated;
GRANT ALL ON FUNCTION public.set_staff_password(p_staff_id uuid, p_password text) TO service_role;


--
-- Name: FUNCTION set_staff_permissions(p_staff_id uuid, p_permissions jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_staff_permissions(p_staff_id uuid, p_permissions jsonb) TO anon;
GRANT ALL ON FUNCTION public.set_staff_permissions(p_staff_id uuid, p_permissions jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.set_staff_permissions(p_staff_id uuid, p_permissions jsonb) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION sync_customer_totals(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_customer_totals() TO anon;
GRANT ALL ON FUNCTION public.sync_customer_totals() TO authenticated;
GRANT ALL ON FUNCTION public.sync_customer_totals() TO service_role;


--
-- Name: FUNCTION sync_invoice_payment_totals(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_invoice_payment_totals() TO anon;
GRANT ALL ON FUNCTION public.sync_invoice_payment_totals() TO authenticated;
GRANT ALL ON FUNCTION public.sync_invoice_payment_totals() TO service_role;


--
-- Name: FUNCTION update_product_qr_rpc(p_staff_id uuid, p_product_id uuid, p_qr_url text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_product_qr_rpc(p_staff_id uuid, p_product_id uuid, p_qr_url text) TO anon;
GRANT ALL ON FUNCTION public.update_product_qr_rpc(p_staff_id uuid, p_product_id uuid, p_qr_url text) TO authenticated;
GRANT ALL ON FUNCTION public.update_product_qr_rpc(p_staff_id uuid, p_product_id uuid, p_qr_url text) TO service_role;


--
-- Name: FUNCTION verify_staff_login(p_email text, p_password text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.verify_staff_login(p_email text, p_password text) TO anon;
GRANT ALL ON FUNCTION public.verify_staff_login(p_email text, p_password text) TO authenticated;
GRANT ALL ON FUNCTION public.verify_staff_login(p_email text, p_password text) TO service_role;


--
-- Name: FUNCTION verify_staff_password(p_staff_id uuid, p_password text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.verify_staff_password(p_staff_id uuid, p_password text) TO anon;
GRANT ALL ON FUNCTION public.verify_staff_password(p_staff_id uuid, p_password text) TO authenticated;
GRANT ALL ON FUNCTION public.verify_staff_password(p_staff_id uuid, p_password text) TO service_role;


--
-- Name: FUNCTION write_audit_log(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.write_audit_log() TO anon;
GRANT ALL ON FUNCTION public.write_audit_log() TO authenticated;
GRANT ALL ON FUNCTION public.write_audit_log() TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_logs TO anon;
GRANT ALL ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.categories TO anon;
GRANT ALL ON TABLE public.categories TO authenticated;
GRANT ALL ON TABLE public.categories TO service_role;


--
-- Name: TABLE company_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.company_settings TO anon;
GRANT ALL ON TABLE public.company_settings TO authenticated;
GRANT ALL ON TABLE public.company_settings TO service_role;


--
-- Name: TABLE metal_rates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.metal_rates TO anon;
GRANT ALL ON TABLE public.metal_rates TO authenticated;
GRANT ALL ON TABLE public.metal_rates TO service_role;


--
-- Name: TABLE current_metal_rates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.current_metal_rates TO anon;
GRANT ALL ON TABLE public.current_metal_rates TO authenticated;
GRANT ALL ON TABLE public.current_metal_rates TO service_role;


--
-- Name: TABLE customer_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customer_orders TO anon;
GRANT ALL ON TABLE public.customer_orders TO authenticated;
GRANT ALL ON TABLE public.customer_orders TO service_role;


--
-- Name: TABLE invoice_charges; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_charges TO anon;
GRANT ALL ON TABLE public.invoice_charges TO authenticated;
GRANT ALL ON TABLE public.invoice_charges TO service_role;


--
-- Name: TABLE invoice_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_counters TO anon;
GRANT ALL ON TABLE public.invoice_counters TO authenticated;
GRANT ALL ON TABLE public.invoice_counters TO service_role;


--
-- Name: TABLE invoice_exchange_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_exchange_items TO anon;
GRANT ALL ON TABLE public.invoice_exchange_items TO authenticated;
GRANT ALL ON TABLE public.invoice_exchange_items TO service_role;


--
-- Name: TABLE invoice_item_value_added_charges; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_item_value_added_charges TO anon;
GRANT ALL ON TABLE public.invoice_item_value_added_charges TO authenticated;
GRANT ALL ON TABLE public.invoice_item_value_added_charges TO service_role;


--
-- Name: TABLE invoice_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_items TO anon;
GRANT ALL ON TABLE public.invoice_items TO authenticated;
GRANT ALL ON TABLE public.invoice_items TO service_role;


--
-- Name: TABLE invoice_list_view; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_list_view TO anon;
GRANT ALL ON TABLE public.invoice_list_view TO authenticated;
GRANT ALL ON TABLE public.invoice_list_view TO service_role;


--
-- Name: SEQUENCE invoice_number_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.invoice_number_seq TO anon;
GRANT ALL ON SEQUENCE public.invoice_number_seq TO authenticated;
GRANT ALL ON SEQUENCE public.invoice_number_seq TO service_role;


--
-- Name: TABLE invoice_payment_splits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_payment_splits TO anon;
GRANT ALL ON TABLE public.invoice_payment_splits TO authenticated;
GRANT ALL ON TABLE public.invoice_payment_splits TO service_role;


--
-- Name: TABLE invoice_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_settings TO anon;
GRANT ALL ON TABLE public.invoice_settings TO authenticated;
GRANT ALL ON TABLE public.invoice_settings TO service_role;


--
-- Name: TABLE making_charge_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.making_charge_rules TO anon;
GRANT ALL ON TABLE public.making_charge_rules TO authenticated;
GRANT ALL ON TABLE public.making_charge_rules TO service_role;


--
-- Name: TABLE metals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.metals TO anon;
GRANT ALL ON TABLE public.metals TO authenticated;
GRANT ALL ON TABLE public.metals TO service_role;


--
-- Name: TABLE notification_dismissals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_dismissals TO anon;
GRANT ALL ON TABLE public.notification_dismissals TO authenticated;
GRANT ALL ON TABLE public.notification_dismissals TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE panchangam_days; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.panchangam_days TO anon;
GRANT ALL ON TABLE public.panchangam_days TO authenticated;
GRANT ALL ON TABLE public.panchangam_days TO service_role;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payments TO anon;
GRANT ALL ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;


--
-- Name: TABLE product_diamonds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_diamonds TO anon;
GRANT ALL ON TABLE public.product_diamonds TO authenticated;
GRANT ALL ON TABLE public.product_diamonds TO service_role;


--
-- Name: TABLE product_images; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_images TO anon;
GRANT ALL ON TABLE public.product_images TO authenticated;
GRANT ALL ON TABLE public.product_images TO service_role;


--
-- Name: TABLE product_stones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_stones TO anon;
GRANT ALL ON TABLE public.product_stones TO authenticated;
GRANT ALL ON TABLE public.product_stones TO service_role;


--
-- Name: TABLE product_value_added_charges; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_value_added_charges TO anon;
GRANT ALL ON TABLE public.product_value_added_charges TO authenticated;
GRANT ALL ON TABLE public.product_value_added_charges TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE purities; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.purities TO anon;
GRANT ALL ON TABLE public.purities TO authenticated;
GRANT ALL ON TABLE public.purities TO service_role;


--
-- Name: TABLE sequence_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sequence_counters TO anon;
GRANT ALL ON TABLE public.sequence_counters TO authenticated;
GRANT ALL ON TABLE public.sequence_counters TO service_role;


--
-- Name: TABLE staff; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.staff TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.staff TO authenticated;
GRANT ALL ON TABLE public.staff TO service_role;


--
-- Name: COLUMN staff.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.staff TO anon;
GRANT SELECT(id) ON TABLE public.staff TO authenticated;


--
-- Name: COLUMN staff.name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(name) ON TABLE public.staff TO anon;
GRANT SELECT(name) ON TABLE public.staff TO authenticated;


--
-- Name: COLUMN staff.phone; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(phone) ON TABLE public.staff TO anon;
GRANT SELECT(phone) ON TABLE public.staff TO authenticated;


--
-- Name: COLUMN staff.email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(email) ON TABLE public.staff TO anon;
GRANT SELECT(email) ON TABLE public.staff TO authenticated;


--
-- Name: COLUMN staff.role; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(role) ON TABLE public.staff TO anon;
GRANT SELECT(role) ON TABLE public.staff TO authenticated;


--
-- Name: COLUMN staff.is_active; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(is_active) ON TABLE public.staff TO anon;
GRANT SELECT(is_active) ON TABLE public.staff TO authenticated;


--
-- Name: COLUMN staff.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.staff TO anon;
GRANT SELECT(created_at) ON TABLE public.staff TO authenticated;


--
-- Name: TABLE staff_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_permissions TO anon;
GRANT ALL ON TABLE public.staff_permissions TO authenticated;
GRANT ALL ON TABLE public.staff_permissions TO service_role;


--
-- Name: TABLE stones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stones TO anon;
GRANT ALL ON TABLE public.stones TO authenticated;
GRANT ALL ON TABLE public.stones TO service_role;


--
-- Name: TABLE subcategories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subcategories TO anon;
GRANT ALL ON TABLE public.subcategories TO authenticated;
GRANT ALL ON TABLE public.subcategories TO service_role;


--
-- Name: TABLE tax_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tax_settings TO anon;
GRANT ALL ON TABLE public.tax_settings TO authenticated;
GRANT ALL ON TABLE public.tax_settings TO service_role;


--
-- Name: TABLE value_added_charge_types; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.value_added_charge_types TO anon;
GRANT ALL ON TABLE public.value_added_charge_types TO authenticated;
GRANT ALL ON TABLE public.value_added_charge_types TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 0gDcBRmSJ6hqnJtSdZx7eX5zJnQjoePV0SNHaw8HUpKP1N1fOXIEF8TK8dIfTsw

