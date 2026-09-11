-- Restrict the automatic RLS event-trigger helper to its owner.
--
-- This function is an infrastructure hook. It is not an application RPC and
-- must never be callable through Supabase's exposed anon/authenticated roles.
do $security$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public';

    if to_regrole('anon') is not null then
      execute 'revoke execute on function public.rls_auto_enable() from anon';
    end if;

    if to_regrole('authenticated') is not null then
      execute 'revoke execute on function public.rls_auto_enable() from authenticated';
    end if;

    if to_regrole('service_role') is not null then
      execute 'revoke execute on function public.rls_auto_enable() from service_role';
    end if;
  end if;
end
$security$;
