import React from "react";
import {
  FilesIcon,
  MagnifyingGlassIcon,
  GitBranchIcon,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useFileSystem } from "../../context/FileSystemContext";

type PanelId = "explorer" | "search" | "git";

interface PanelDef {
  id: PanelId;
  label: string;
  Icon: PhosphorIcon;
}

interface ActivityBarProps {
  activePanel: PanelId | null;
  onPanelToggle: (panelId: PanelId) => void;
}

const PANELS: PanelDef[] = [
  { id: "explorer", label: "Explorer", Icon: FilesIcon },
  { id: "search", label: "Search", Icon: MagnifyingGlassIcon },
  { id: "git", label: "Source Control", Icon: GitBranchIcon },
];

export default function ActivityBar({
  activePanel,
  onPanelToggle,
}: ActivityBarProps) {
  const { gitChangeCount } = useFileSystem();

  return (
    <div
      className="flex flex-col items-center w-12 shrink-0 bg-bg-surface relative z-20 shadow-[4px_0_12px_rgba(0,0,0,0.1)]"
      role="toolbar"
      aria-label="Activity Bar"
    >
      {/* Quipu brand icon — aligns with TitleBar height */}
      <div className="w-full h-9 flex items-center justify-center shrink-0 border-b border-border">
        <img
          src={new URL('../../assets/quipu-icon.png', import.meta.url).href}
          alt="Quipu"
          className="w-5 h-5 select-none pointer-events-none"
          draggable={false}
        />
      </div>

      <div className="flex flex-col items-center pt-2 flex-1">
      {PANELS.map((panel) => {
        const isActive = activePanel === panel.id;
        return (
          <button
            key={panel.id}
            className={cn(
              "w-9 h-9 mx-1.5 mt-0.5 flex items-center justify-center rounded-lg",
              "bg-transparent cursor-pointer transition-colors",
              "text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated",
              isActive && "text-text-primary bg-bg-elevated",
            )}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onClick={() => onPanelToggle(panel.id)}
            aria-label={panel.label}
            title={panel.label}
          >
            <div className="relative">
              <panel.Icon weight={isActive ? "regular" : "light"} size={20} />
              {panel.id === "git" && gitChangeCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center px-1">
                  {gitChangeCount > 99 ? "99+" : gitChangeCount}
                </span>
              )}
            </div>
          </button>
        );
      })}
      </div>
    </div>
  );
}
