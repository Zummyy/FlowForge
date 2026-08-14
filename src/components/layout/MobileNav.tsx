"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MOBILE_NAV_ITEMS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/vault", label: "Vault", icon: "📝" },
  { href: "/studio", label: "Studio", icon: "🎛️" },
  { href: "/feed", label: "Feed", icon: "🔥" },
  { href: "/profile", label: "Profil", icon: "👤" },
];

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-zinc-900/95 backdrop-blur-xl border-t border-zinc-800/50 safe-area-bottom">
      <div className="flex items-center justify-around px-2 py-2">
        {MOBILE_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-200 min-w-[52px]
                ${isActive
                  ? "text-amber-500"
                  : "text-zinc-500 active:text-zinc-300"
                }`}
            >
              <span className={`text-xl transition-transform ${isActive ? "scale-110" : ""}`}>
                {item.icon}
              </span>
              <span className="text-[10px] font-medium">{item.label}</span>
              {isActive && (
                <div className="w-4 h-0.5 rounded-full bg-amber-500 -mt-0.5" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
