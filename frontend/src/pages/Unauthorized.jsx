import { Link } from 'react-router-dom';

export default function Unauthorized() {
  return (
    <div className="unauthorized-page">
      <h1>Access Denied</h1>
      <p>You don't have permission to view this page.</p>
      <Link to="/templates">Go back</Link>
    </div>
  );
}
