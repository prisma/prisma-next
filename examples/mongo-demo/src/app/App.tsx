import { useEffect, useState } from 'react';
import type { ApiTask, ApiUser } from '../types';
import { TaskList } from './TaskList';
import { UserList } from './UserList';

type Tab = 'tasks' | 'users';

export function App() {
  const [tab, setTab] = useState<Tab>('tasks');
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [tasksRes, usersRes] = await Promise.all([fetch('/api/tasks'), fetch('/api/users')]);

        if (!tasksRes.ok || !usersRes.ok) {
          throw new Error('API request failed');
        }

        setTasks((await tasksRes.json()) as ApiTask[]);
        setUsers((await usersRes.json()) as ApiUser[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">
          <h2>Error</h2>
          <p>{error}</p>
          <p className="hint">
            Make sure the API server is running: <code>pnpm dev:api</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <header>
        <h1>Task Tracker</h1>
        <p className="subtitle">
          Prisma Next — Mongo ORM demo with polymorphism, embedded documents, and reference
          relations
        </p>
      </header>

      <nav className="tabs">
        <button
          type="button"
          className={tab === 'tasks' ? 'active' : ''}
          onClick={() => setTab('tasks')}
        >
          Tasks ({tasks.length})
        </button>
        <button
          type="button"
          className={tab === 'users' ? 'active' : ''}
          onClick={() => setTab('users')}
        >
          Team ({users.length})
        </button>
      </nav>

      <main>{tab === 'tasks' ? <TaskList tasks={tasks} /> : <UserList users={users} />}</main>

      <footer>
        <div className="legend">
          <h3>Features demonstrated</h3>
          <ul>
            <li>
              <strong>Polymorphism</strong> — Tasks use a <code>type</code> discriminator with Bug
              and Feature variants, each carrying different fields
            </li>
            <li>
              <strong>Embedded documents</strong> — Addresses are embedded in Users, Comments in
              Tasks (no separate collection, no <code>$lookup</code>)
            </li>
            <li>
              <strong>Reference relations</strong> — Task.assignee resolves to User via{' '}
              <code>$lookup</code> on <code>assigneeId</code>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
