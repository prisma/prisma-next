import { Form, redirect } from 'react-router';
import { getDb } from '~/lib/db.server';
import type { Route } from './+types/users';

export async function loader() {
  const db = getDb();
  const plan = db.sql.user.select('id', 'email', 'createdAt').limit(20).build();
  const rows = await db.runtime().execute(plan);
  return { rows };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();
  if (!email) {
    throw new Response('email required', { status: 400 });
  }
  const db = getDb();
  const plan = db.sql.user.insert({ email }).returning('id', 'email').build();
  await db.runtime().execute(plan);
  return redirect('/');
}

export default function Users({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>Users</h1>
      <Form method="post">
        <label>
          Email <input name="email" type="email" required />
        </label>
        <button type="submit">Create user</button>
      </Form>
      <ul>
        {loaderData.rows.map((row) => (
          <li key={row.id}>{row.email}</li>
        ))}
      </ul>
    </main>
  );
}
