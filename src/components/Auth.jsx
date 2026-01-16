import { login, logout } from '../utils/auth';

export default function Auth({ user, onUserChange }) {
  const handleLogin = () => {
    login();
  };

  const handleLogout = async () => {
    await logout();
    if (onUserChange) {
      onUserChange(null);
    }
  };

  if (!user) {
    return (
      <div className="auth">
        <p>Please log in to save and sync your drafts across devices.</p>
        <button onClick={handleLogin} className="btn btn-primary">
          🔐 Login with GitHub
        </button>
      </div>
    );
  }

  return (
    <div className="auth">
      <div className="user-info">
        <p>
          <strong>Logged in as:</strong> {user.name || user.email || `User ${user.id}`}
        </p>
        <button onClick={handleLogout} className="btn btn-secondary">
          Logout
        </button>
      </div>
    </div>
  );
}
