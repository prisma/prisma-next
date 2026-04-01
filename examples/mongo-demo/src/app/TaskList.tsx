import type { ApiTask } from '../types';

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

function TaskCard({ task }: { task: ApiTask }) {
  return (
    <div className={`card ${task.type === 'bug' ? 'card-bug' : 'card-feature'}`}>
      <div className="card-header">
        <span className={`type-badge ${task.type === 'bug' ? 'type-bug' : 'type-feature'}`}>
          {task.type === 'bug' ? 'Bug' : 'Feature'}
        </span>
        <h3>{task.title}</h3>
      </div>

      <div className="card-meta">
        {task.type === 'bug' ? (
          <span className={`badge ${getSeverityClass(task.severity)}`}>
            Severity: {task.severity}
          </span>
        ) : (
          <>
            <span className={`badge ${getPriorityClass(task.priority)}`}>
              Priority: {task.priority}
            </span>
            <span className="badge badge-release">Release: {task.targetRelease}</span>
          </>
        )}

        {task.assignee && (
          <span className="badge badge-assignee">Assignee: {task.assignee.name}</span>
        )}
      </div>

      {task.comments.length > 0 && (
        <div className="comments">
          <h4>Comments ({task.comments.length})</h4>
          {task.comments.map((comment) => (
            <div key={comment._id} className="comment">
              <p>{comment.text}</p>
              <time>{new Date(comment.createdAt).toLocaleDateString()}</time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskList({ tasks }: { tasks: ApiTask[] }) {
  const bugs = tasks.filter((t): t is ApiTask & { type: 'bug' } => t.type === 'bug');
  const features = tasks.filter((t): t is ApiTask & { type: 'feature' } => t.type === 'feature');

  return (
    <div className="task-list">
      <section>
        <h2>Bugs ({bugs.length})</h2>
        <div className="cards">
          {bugs.map((task) => (
            <TaskCard key={task._id} task={task} />
          ))}
        </div>
      </section>

      <section>
        <h2>Features ({features.length})</h2>
        <div className="cards">
          {features.map((task) => (
            <TaskCard key={task._id} task={task} />
          ))}
        </div>
      </section>
    </div>
  );
}
