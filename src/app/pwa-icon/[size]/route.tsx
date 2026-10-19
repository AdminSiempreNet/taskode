import { ImageResponse } from "next/og";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ size: string }> },
) {
  const { size: value } = await context.params;
  if (!["192", "512"].includes(value))
    return new Response(null, { status: 404 });
  const size = Number(value);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#10251f",
      }}
    >
      <svg
        width={size * 0.7}
        height={size * 0.7}
        viewBox="0 0 32 32"
        fill="none"
      >
        <rect width="32" height="32" rx="9" fill="#80d4ae" />
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
    </div>,
    {
      width: size,
      height: size,
      headers: { "Cache-Control": "public, max-age=86400" },
    },
  );
}
