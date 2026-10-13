-- Every session in this database runs on India time.
--
-- "Today" on the restaurant dashboard and the day-by-day earnings depend on
-- the session clock. Asking for it per connection is not enough: Neon's
-- connection proxy ignores the timezone a client requests at startup, and the
-- pool's RESET ALL between uses reverts anything set afterwards. A database
-- default is the one setting both of those respect.

do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Asia/Kolkata');
end
$$;
