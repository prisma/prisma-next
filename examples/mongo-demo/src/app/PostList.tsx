interface Post {
  _id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: string;
  author?: { _id: string; name: string; email: string; bio: string | null };
}

function PostCard({ post }: { post: Post }) {
  return (
    <div className="card">
      <div className="card-header">
        <h3>{post.title}</h3>
      </div>
      <p className="card-content">{post.content}</p>
      <div className="card-meta">
        {post.author && <span className="badge badge-assignee">By {post.author.name}</span>}
        <span className="badge">{new Date(post.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export function PostList({ posts }: { posts: Post[] }) {
  return (
    <div className="post-list">
      <h2>Posts ({posts.length})</h2>
      <div className="cards">
        {posts.map((post) => (
          <PostCard key={post._id} post={post} />
        ))}
      </div>
    </div>
  );
}
