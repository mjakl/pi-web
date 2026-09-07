export function StarIcon({
  filled = false,
  size = 14,
}: {
  filled?: boolean;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39L17.56 20 12 17.13 6.44 20l1.06-6.07L3 9.54l6.22-.91L12 3Z" />
    </svg>
  );
}
