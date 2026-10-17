export function TaskodeMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="taskode-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <g
        stroke="#10251f"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m10 9-6 7 6 7m12-14 6 7-6 7" />
        <path d="m12 16 3 3 5-7" />
      </g>
    </svg>
  );
}

export function TaskodeBrand() {
  return (
    <div className="auth-brand">
      <TaskodeMark />
      <span>Taskode</span>
    </div>
  );
}
