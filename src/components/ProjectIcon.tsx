import {
  Folder, Code, Terminal, Laptop, Database, Bug, FlaskConical, Book, Briefcase, Leaf,
  Star, Target, Rocket, Heart, Palette, Camera, Music, Globe, Calendar, Wallet, Home,
  Coffee, GraduationCap, Lightbulb, Wrench, PenTool,
  type LucideProps,
} from "lucide-react";

export const PROJECT_ICONS = {
  folder: Folder,
  code: Code,
  terminal: Terminal,
  laptop: Laptop,
  database: Database,
  bug: Bug,
  flask: FlaskConical,
  book: Book,
  briefcase: Briefcase,
  leaf: Leaf,
  star: Star,
  target: Target,
  rocket: Rocket,
  heart: Heart,
  palette: Palette,
  camera: Camera,
  music: Music,
  globe: Globe,
  calendar: Calendar,
  wallet: Wallet,
  home: Home,
  coffee: Coffee,
  graduation: GraduationCap,
  lightbulb: Lightbulb,
  wrench: Wrench,
  pen: PenTool,
} as const;

export type ProjectIconId = keyof typeof PROJECT_ICONS;
export const PROJECT_ICON_IDS = Object.keys(PROJECT_ICONS) as ProjectIconId[];

export default function ProjectIcon({
  icon,
  ...props
}: LucideProps & { icon: string | null | undefined }) {
  if (!icon || !Object.prototype.hasOwnProperty.call(PROJECT_ICONS, icon)) return null;
  const Icon = PROJECT_ICONS[icon as ProjectIconId];
  return <Icon aria-hidden="true" {...props} />;
}
