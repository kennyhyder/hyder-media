const ROLE_COLORS: Record<string, string> = {
  installer: "bg-blue-100 text-blue-700",
  owner: "bg-green-100 text-green-700",
  developer: "bg-purple-100 text-purple-700",
  operator: "bg-amber-100 text-amber-700",
  manufacturer: "bg-red-100 text-red-700",
};

export default function EntityBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] || "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${color}`}>
      {role}
    </span>
  );
}
