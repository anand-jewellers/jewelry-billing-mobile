-- auth_trigger.sql
-- Run this in the NEW project AFTER schema.sql (it needs public.handle_new_auth_user()).

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;

CREATE TRIGGER trg_on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
