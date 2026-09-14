import type { PropsWithChildren, ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  className?: string;
}

export function Card({
  title,
  subtitle,
  extra,
  children,
  className,
}: PropsWithChildren<CardProps>) {
  return (
    <div className={className ? `card ${className}` : 'card'}>
      {(title || extra) && (
        <div className="card-header">
          {subtitle ? (
            <div className="card-title-group">
              <div className="title">{title}</div>
              <div className="subtitle">{subtitle}</div>
            </div>
          ) : (
            <div className="title">{title}</div>
          )}
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}
