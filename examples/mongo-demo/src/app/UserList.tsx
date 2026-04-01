type User = Record<string, unknown>;
type Address = Record<string, unknown>;

function UserCard({ user }: { user: User }) {
  const addresses = (user['addresses'] ?? []) as Address[];

  return (
    <div className="card">
      <div className="card-header">
        <div className="avatar">{(user['name'] as string).charAt(0)}</div>
        <div>
          <h3>{user['name'] as string}</h3>
          <p className="email">{user['email'] as string}</p>
        </div>
      </div>

      {addresses.length > 0 && (
        <div className="addresses">
          <h4>Addresses ({addresses.length})</h4>
          {addresses.map((addr) => (
            <div key={addr['street'] as string} className="address">
              <p>{addr['street'] as string}</p>
              <p>
                {addr['city'] as string}, {addr['zip'] as string}
              </p>
            </div>
          ))}
        </div>
      )}

      {addresses.length === 0 && <p className="no-data">No addresses on file</p>}
    </div>
  );
}

export function UserList({ users }: { users: User[] }) {
  return (
    <div className="user-list">
      <h2>Team Members</h2>
      <div className="cards">
        {users.map((user) => (
          <UserCard key={user['_id'] as string} user={user} />
        ))}
      </div>
    </div>
  );
}
