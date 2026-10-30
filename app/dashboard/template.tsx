// Re-mounts on every dashboard navigation, giving each page a soft entrance.
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-in duration-500 ease-out fade-in-0 slide-in-from-bottom-2">{children}</div>;
}
