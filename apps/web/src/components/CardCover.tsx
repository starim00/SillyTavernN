import { Books } from "@phosphor-icons/react";
import { useState } from "react";

export function CardCover({
  src,
  className,
  placeholderClassName,
  size = 25,
}: {
  src?: string | undefined;
  className?: string;
  placeholderClassName?: string;
  size?: number;
}) {
  const [failure, setFailure] = useState({ src, attempts: 0 });
  const attempts = failure.src === src ? failure.attempts : 0;
  const coverUrl = src?.startsWith("/api/assets/cards/")
    ? `${src}${src.includes("?") ? "&" : "?"}preview=1`
    : src;
  if (!coverUrl || attempts >= 2) {
    return (
      <span
        className={placeholderClassName}
        title={src ? "封面暂时无法加载" : undefined}
      >
        <Books size={size} />
      </span>
    );
  }
  return (
    <img
      className={className}
      src={
        attempts === 1 && coverUrl.startsWith("/api/assets/cards/")
          ? `${coverUrl}&retry=1`
          : coverUrl
      }
      alt=""
      loading="lazy"
      onError={() =>
        setFailure({
          src,
          attempts: coverUrl.startsWith("/api/assets/cards/")
            ? attempts + 1
            : 2,
        })
      }
    />
  );
}
