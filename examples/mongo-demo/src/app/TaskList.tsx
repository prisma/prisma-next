type Task = Record<string, unknown>;

function getSeverityClass(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'badge-critical';
    case 'medium':
      return 'badge-medium';
    default:
      return 'badge-low';
  }
}

function getPriorityClass(priority: string): string {
  switch (priority) {
    case 'high':
      return 'badge-critical';
    case 'medium':
      return 'badge-medium';
    default:
      return 'badge-low';
  }
}

function TaskCard({ task }: { task: Task }) {
  const isBug = task['type'] === 'bug';
  const comments = (task['comments'] ?? []) as Array<Record<string, unknown>>;
  const assignee = task['assignee'] as Record<string, unknown> | undefined;

  return (
    <div className={`card ${isBug ? 'card-bug' : 'card-feature'}`}>
      <div className="card-header">
        <span className={`type-badge ${isBug ? 'type-bug' : 'type-feature'}`}>
          {isBug ? 'Bug' : 'Feature'}
        </span>
        <h3>{task['title'] as string}</h3>
      </div>

      <div className="card-meta">
        {isBug ? (
          <span className={`badge ${getSeverityClass(task['severity'] as string)}`}>
            Severity: {task['severity'] as string}
          </span>
        ) : (
          <>
            <span className={`badge ${getPriorityClass(task['priority'] as string)}`}>
              Priority: {task['priority'] as string}
            </span>
            <span className="badge badge-release">Release: {task['targetRelease'] as string}</span>
          </>
        )}

        {assignee && (
          <span className="badge badge-assignee">Assignee: {assignee['name'] as string}</span>
        )}
      </div>

      {comments.length > 0 && (
        <div className="comments">
          <h4>Comments ({comments.length})</h4>
          {comments.map((comment) => (
            <div key={comment['_id'] as string} className="comment">
              <p>{comment['text'] as string}</p>
              <time>{new Date(comment['createdAt'] as string).toLocaleDateString()}</time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskList({ tasks }: { tasks: Task[] }) {
  const bugs = tasks.filter((t) => t['type'] === 'bug');
  const features = tasks.filter((t) => t['type'] === 'feature');

  return (
    <div className="task-list">
      <section>
        <h2>Bugs ({bugs.length})</h2>
        <div className="cards">
          {bugs.map((task) => (
            <TaskCard key={task['_id'] as string} task={task} />
          ))}
        </div>
      </section>

      <section>
        <h2>Features ({features.length})</h2>
        <div className="cards">
          {features.map((task) => (
            <TaskCard key={task['_id'] as string} task={task} />
          ))}
        </div>
      </section>
    </div>
  );
}
