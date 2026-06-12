# Supabase RLS Policies
- Always enable RLS on every table.
- Create policies for `SELECT`, `INSERT`, `UPDATE`, `DELETE`.
- Use `auth.uid()` to restrict data to the owner.
- Use `service_role` key ONLY for administrative tasks.
