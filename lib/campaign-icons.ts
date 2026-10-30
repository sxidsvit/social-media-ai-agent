import {
  Camera,
  Flame,
  Globe,
  Heart,
  Leaf,
  Megaphone,
  Rocket,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";

export type CampaignIconPreset = {
  id: string;
  label: string;
  Icon: LucideIcon;
  // Tailwind classes for the icon tile background + foreground
  tone: string;
};

export const CAMPAIGN_ICONS: CampaignIconPreset[] = [
  { id: "rocket", label: "Rocket", Icon: Rocket, tone: "bg-linear-to-br from-blue-500 to-indigo-600 text-white" },
  { id: "sparkles", label: "Sparkles", Icon: Sparkles, tone: "bg-linear-to-br from-fuchsia-500 to-purple-600 text-white" },
  { id: "megaphone", label: "Megaphone", Icon: Megaphone, tone: "bg-linear-to-br from-orange-400 to-rose-500 text-white" },
  { id: "leaf", label: "Leaf", Icon: Leaf, tone: "bg-linear-to-br from-emerald-400 to-green-600 text-white" },
  { id: "flame", label: "Flame", Icon: Flame, tone: "bg-linear-to-br from-amber-400 to-orange-500 text-white" },
  { id: "star", label: "Star", Icon: Star, tone: "bg-linear-to-br from-sky-400 to-blue-600 text-white" },
  { id: "heart", label: "Heart", Icon: Heart, tone: "bg-linear-to-br from-pink-400 to-rose-600 text-white" },
  { id: "camera", label: "Camera", Icon: Camera, tone: "bg-linear-to-br from-slate-600 to-slate-800 text-white" },
  { id: "globe", label: "Globe", Icon: Globe, tone: "bg-linear-to-br from-cyan-400 to-teal-600 text-white" },
];

export function getCampaignIcon(id: string | null | undefined) {
  return CAMPAIGN_ICONS.find((icon) => icon.id === id);
}
