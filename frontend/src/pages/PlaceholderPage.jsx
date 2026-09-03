// Shared placeholder for pages that later phases will implement fully.
export default function PlaceholderPage({ title, note }) {
  return (
    <div className="placeholder-page">
      <h1>{title}</h1>
      <p>{note || 'This module will be built in a later phase.'}</p>
    </div>
  );
}
