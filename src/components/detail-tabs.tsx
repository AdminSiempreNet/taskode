"use client";
import type { ReactNode } from "react";
import { Tabs } from "radix-ui";

export type DetailSection = {
  id: string;
  label: string;
  icon: ReactNode;
  count?: number;
};
export function DetailTabs({
  value,
  change,
  label,
  sections,
  children,
}: {
  value: string;
  change: (value: string) => void;
  label: string;
  sections: DetailSection[];
  children: ReactNode;
}) {
  return (
    <Tabs.Root
      value={value}
      orientation="vertical"
      onValueChange={change}
      className="task-detail-tabs"
    >
      <Tabs.List className="task-section-tabs" aria-label={label}>
        {sections.map((section) => (
          <Tabs.Trigger
            key={section.id}
            value={section.id}
            type="button"
            title={section.label}
          >
            {section.icon}
            <span className="task-tab-label">{section.label}</span>
            {!!section.count && (
              <span className="task-tab-count">{section.count}</span>
            )}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}
