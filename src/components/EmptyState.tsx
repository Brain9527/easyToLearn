interface EmptyStateProps {
  title: string;
  description: string;
  action?: preact.ComponentChildren;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="emptyState card">
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
