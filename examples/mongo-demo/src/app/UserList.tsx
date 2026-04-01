import type { ApiUser } from '../types';

function UserCard({ user }: { user: ApiUser }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="avatar">{user.name.charAt(0)}</div>
        <div>
          <h3>{user.name}</h3>
          <p className="email">{user.email}</p>
        </div>
      </div>

      {user.addresses.length > 0 && (
        <div className="addresses">
          <h4>Addresses ({user.addresses.length})</h4>
          {user.addresses.map((addr) => (
            <div key={addr.street} className="address">
              <p>{addr.street}</p>
              <p>
                {addr.city}, {addr.zip}
              </p>
            </div>
          ))}
        </div>
      )}

      {user.addresses.length === 0 && <p className="no-data">No addresses on file</p>}
    </div>
  );
}

export function UserList({ users }: { users: ApiUser[] }) {
  return (
    <div className="user-list">
      <h2>Team Members</h2>
      <div className="cards">
        {users.map((user) => (
          <UserCard key={user._id} user={user} />
        ))}
      </div>
    </div>
  );
}
