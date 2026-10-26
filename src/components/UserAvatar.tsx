import React, { useEffect, useState } from 'react';

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  sizeClass?: string;
  textClass?: string;
}

export function UserAvatar({
  name,
  avatarUrl,
  sizeClass = 'w-14 h-14 rounded-xl',
  textClass = 'text-lg',
}: UserAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [avatarUrl]);

  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl}
        alt={`${name} profile photo`}
        onError={() => setImgFailed(true)}
        className={`${sizeClass} object-cover border border-[var(--border-strong)] bg-[var(--bg-surface)] shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} bg-[var(--bg-surface)] border border-[var(--border-strong)] flex items-center justify-center font-bold font-display text-[var(--accent-lime)] shrink-0 ${textClass}`}
    >
      {initials || 'HF'}
    </div>
  );
}
