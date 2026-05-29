import React from "react";
import {
  FilesIcon,
  MagnifyingGlassIcon,
  GitBranchIcon,
  PuzzlePieceIcon,
  CircleIcon,
  RobotIcon,
  GitForkIcon,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useFileSystem } from "../../context/FileSystemContext";
import { getRegisteredPanels, updateGitBadgeCount } from "../../extensions/panelRegistry";

const ICON_MAP: Record<string, PhosphorIcon> = {
  FilesIcon,
  MagnifyingGlassIcon,
  GitBranchIcon,
  PuzzlePieceIcon,
  RobotIcon,
  GitForkIcon,
};

interface ActivityBarProps {
  activePanel: string | null;
  onPanelToggle: (panelId: string) => void;
  /** Click handler for the brand logo — used to collapse the sidebar. */
  onLogoClick?: () => void;
}

export default function ActivityBar({
  activePanel,
  onPanelToggle,
  onLogoClick,
}: ActivityBarProps) {
  const { gitChangeCount } = useFileSystem();

  // Update the git badge count before reading panel definitions so the badge
  // callback in panelRegistry reflects the latest count this render.
  updateGitBadgeCount(gitChangeCount);

  const panels = getRegisteredPanels();

  return (
    <div
      className="flex flex-col items-center w-12 shrink-0 relative z-20"
      role="toolbar"
      aria-label="Activity Bar"
    >
      {/* Quipu brand icon — doubles as the sidebar-collapse toggle.
          Aligns with the TitleBar strip height on the editor column. The
          surrounding row stays a window-drag region; only the icon
          itself opts back into `no-drag` so clicks reach React. */}
      <div
        className="w-full h-9 flex items-center justify-center shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onLogoClick}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="w-5 h-5 flex items-center justify-center bg-transparent border-none p-0 cursor-pointer"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <img
            src={new URL('../../assets/quipu-icon.png', import.meta.url).href}
            alt="Quipu"
            className="w-5 h-5 select-none pointer-events-none"
            draggable={false}
          />
        </button>
      </div>

      <div className="flex flex-col items-center pt-2 flex-1">
        {panels.map((panel) => {
          const isActive = activePanel === panel.id;
          const Icon = ICON_MAP[panel.icon] ?? CircleIcon;
          const badgeCount = panel.badge?.() ?? null;
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
                <Icon weight={isActive ? "regular" : "light"} size={20} />
                {badgeCount !== null && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center px-1">
                    {badgeCount > 99 ? "99+" : badgeCount}
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
