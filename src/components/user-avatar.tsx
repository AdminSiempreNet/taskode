"use client";

import { useState } from "react";

export function UserAvatar({
  name,
  image,
}: {
  name: string;
  image?: string | null;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return (
    <span className="user-option-avatar" aria-hidden="true">
      {image && image !== failedImage ? (
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedImage(image)}
        />
      ) : (
        <span>{initials.toLocaleUpperCase("es") || "?"}</span>
      )}
    </span>
  );
}
