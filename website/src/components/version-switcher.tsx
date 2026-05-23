"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

interface Version {
  version: string;
  url: string;
  latest: boolean;
}

export function VersionSwitcher() {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [current, setCurrent] = useState<Version | null>(null);

  useEffect(() => {
    fetch("/alvyn/versions.json")
      .then((res) => res.json())
      .then((data: Version[]) => {
        setVersions(data);
        const match = window.location.pathname.match(/\/alvyn\/v(\d+\.\d+)\//);
        if (match) {
          setCurrent(data.find((v) => v.version === match[1]) ?? data[0]);
        } else {
          setCurrent(data.find((v) => v.latest) ?? data[0]);
        }
      })
      .catch((err) => console.error("Failed to load versions:", err));
  }, []);

  if (!current) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-sm font-medium transition-colors hover:bg-fd-accent"
      >
        v{current.version}
        {current.latest && " (Latest)"}
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-md border bg-fd-background p-1 shadow-md">
            {versions.map((v) => (
              <a
                key={v.version}
                href={v.url}
                className={`block rounded-sm px-3 py-1.5 text-sm transition-colors hover:bg-fd-accent ${
                  v.version === current.version
                    ? "font-medium text-fd-primary"
                    : ""
                }`}
              >
                v{v.version}
                {v.latest && " (Latest)"}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
