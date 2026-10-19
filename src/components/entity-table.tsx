"use client";
import type { ReactNode } from "react";

export function EntityTable({
  title,
  icon,
  count,
  countLabel,
  columns,
  children,
  action,
  className = "",
}: {
  title: string;
  icon?: ReactNode;
  count: number;
  countLabel?: string;
  columns: string[];
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`feature-table ${className}`}>
      <div className="feature-table-header">
        {icon}
        <h2>{title}</h2>
        <span>{countLabel ?? count}</span>
        {action}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  );
}
