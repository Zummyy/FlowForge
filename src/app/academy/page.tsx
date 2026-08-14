"use client";

import { useState } from "react";
import AppShell from "@/components/layout/AppShell";

interface Article {
  id: string;
  title: string;
  category: string;
  readTime: string;
  content: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  icon: string;
}

const ARTICLES: Article[] = [
  {
    id: "1",
    title: "Podstawy Budowania Rymów Wielosylabowych",
    category: "Rymy",
    readTime: "5 min",
    difficulty: "beginner",
    icon: "📝",
    content: `Rymy wielosylabowe to fundament zaawansowanego rapu. Zamiast rymować pojedyncze słowa, łączysz całe frazy lub ich końcówki.

**Technika 1: Dopasowanie sylab**
Weź słowo "przeznaczenie" (5 sylab) i znajdź słowo o tej samej liczbie sylab, które rymuje się z końcówką: "spotkanie", "początkowanie", "dokończenie".

**Technika 2: Rym wewnętrzny**
Umieść rym nie na końcu wersu, ale w jego środku:
"Piszę wersy jak listy do przyszłości, bo hip-hop to moje przeznaczenie"

**Technika 3: Łańcuch rymów**
Połącz kilka rymów wielosylabowych w ciąg:
"creativity → precyzja → ekspresja → refleksja"

Ćwiczenie: Weź 10 słów i do każdego znajdź 3 rymy wielosylabowe.`,
  },
  {
    id: "2",
    title: "Flow: Jak Dostosować Wersy Do Bitu",
    category: "Flow",
    readTime: "7 min",
    difficulty: "intermediate",
    icon: "🎵",
    content: `Flow to sposób, w jaki Twoje słowa układają się na bicie. Dobry flow sprawia, że tekst brzmi naturalnie i rytmicznie.

**Krok 1: Poznaj BPM bitu**
Użyj metronomu w The Vault, aby ustawić tempo. Większość polskiego rapu to 85-100 BPM.

**Krok 2: Policz sylaby na takt**
Przy 90 BPM i 4/4, każdy takt trwa ok. 0.67 sekundy. Przy średnim tempie mówienia (4-5 sylab/sek), to ok. 3-4 sylaby na takt.

**Krok 3: Zaznacz akcenty**
Słowa akcentowane powinny padać na mocne uderzenia bębna (1 i 3 w takcie 4/4).

**Ćwiczenie:** Nagraj się mówiąc tekst bez bitu, potem odtwórz bit i dostosuj prędkość mówienia.`,
  },
  {
    id: "3",
    title: "Technika Mikrofonowa: Jak Brzmieć Profesjonalnie",
    category: "Technika",
    readTime: "6 min",
    difficulty: "beginner",
    icon: "🎙️",
    content: `Dobra technika mikrofonowa może zmienić brzmienie Twojego wokalu z amatorskiego na profesjonalne.

**Odległość od mikrofonu**
- 10-15 cm: Czyste, bezpośrednie brzmienie (rap)
- 20-30 cm: Łagodniejsze, bardziej przestrzenne (śpiew)
- Blisko (5 cm): Efekt proximity - ciepły, basowy sound (do emocjonalnych fragmentów)

**Popping i sizzling**
Używaj pop-filtra, aby uniknąć "p" i "b" powodujących trzaski. Wymawiaj "p" bardziej jak "b".

**Kontrola oddechu**
Ćwicz oddychanie przeponowe. Przed długim wersiem we głęboki oddech i mów z przepony, nie z gardła.

**Ćwiczenie:** Nagraj ten sam fragment 3 razy z różnej odległości i porównaj brzmienie.`,
  },
  {
    id: "4",
    title: "Pisanie Storytellingu: Opowiadanie Historii w Wersach",
    category: "Twórczość",
    readTime: "8 min",
    difficulty: "advanced",
    icon: "📖",
    content: `Storytelling to jedna z najtrudniejszych, ale najbardziej satysfakcjonujących technik w rapie.

**Struktura historii:**
1. **Hook** - Złap uwagę słuchacza od pierwszego wersu
2. **Ekspozycja** - Przedstaw postacie i_setting_
3. **Konflikt** - Buduj napięcie i problemy
4. **Punkt zwrotny** - Moment zmiany
5. **Rozwiązanie** - Zakończenie historii

**Techniki:**
- **Perspektywa pierwszoosobowa** - "Budzę się rano, patrzę w sufit..."
- **Obrazy zmysłowe** - Opisz co widzisz, słyszysz, czujesz
- **Dialogi** - Wprowadź rozmowy między postaciami
- **Foreshadowing** - Zdradź trochę zakończenia na początku

**Ćwiczenie:** Napisz 32-wierszowy utwór opowiadający historię jednego dnia w Twoim życiu.`,
  },
  {
    id: "5",
    title: "Jak Przełamać Blokadę Twórczą (Writer's Block)",
    category: "Twórczość",
    readTime: "4 min",
    difficulty: "beginner",
    icon: "💡",
    content: `Każdy twórca mierzy się z blokadą twórczą. Oto sprawdzone metody:

**Metoda 1: Zmień środowisko**
Napisz w innym miejscu - kawiarnia, park, pociąg. Nowe otoczenie = nowe pomysły.

**Metoda 2: Pisz bez przerwy**
Ustaw timer na 10 minut i pisz cokolwiek przychodzi do głowy. Nie oceniaj, nie poprawiaj. Po 10 minutach przejrzyj tekst - często znajdziesz tam ciekawe pomysły.

**Metoda 3: Użyj Writer's Block Buster**
W The Vault masz wbudowane narzędzie losujące tematy, trudne słowa i wyzwania. Kliknij "Losuj Inspirację" i pisz!

**Metoda 4: Słuchaj bitu**
Odtwórz bit i po prostu mów do niego cokolwiek. Nagraj się. Potem przejrzyj nagranie i wyciągnij najlepsze fragmenty.

**Metoda 5: Czytaj innych**
Przeczytaj tekst ulubionego rapera. Nie kopiuj, ale zainspiruj się techniką i podejściem.`,
  },
  {
    id: "6",
    title: "Słownik Rymów: Jak Znaleźć Idealny Rym",
    category: "Rymy",
    readTime: "5 min",
    difficulty: "intermediate",
    icon: "📚",
    content: `Znalezienie dobrego rymu to nie przypadek - to umiejętność, którą można ćwiczyć.

**Rodzaje rymów:**
1. **Dokładny** - Identyczna końcówka: "czas" → "raz"
2. **Wielosylabowy** - Rymowanie wielu sylab: "przeznaczenie" → "spotkanie"
3. **Asonans** - Podobne samogłoski: "dom" → "sok" (o → o)
4. **Slant** - Częściowe dopasowanie: "prawda" → "sztuka"

**Techniki wyszukiwania:**
- **Asocjacja** - Zapisz słowo i wypisz wszystko, co Ci się kojarzy
- **Synonimy** - Znajdź synonimy i szukaj rymów do nich
- **Zakończenia** - Skup się na ostatnich 2-3 sylabach słowa
- **Asystent Rymów** - Użyj wbudowanego narzędzia w The Vault

**Ćwiczenie:** Wedź 5 słów i do każdego znajdź: 2 rymy dokładne, 2 wielosylabowe i 2 asonanse.`,
  },
];

const DIFFICULTY_COLORS = {
  beginner: "bg-green-500/10 text-green-400",
  intermediate: "bg-amber-500/10 text-amber-500",
  advanced: "bg-red-500/10 text-red-400",
};

const DIFFICULTY_LABELS = {
  beginner: "Początkujący",
  intermediate: "Średniozaawansowany",
  advanced: "Zaawansowany",
};

export default function AcademyPage() {
  const [articles] = useState(ARTICLES);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState("all");

  const categories = ["all", ...new Set(articles.map((a) => a.category))];
  const filtered = articles.filter(
    (a) => filterCategory === "all" || a.category === filterCategory
  );

  return (
    <AppShell>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
            <span className="text-lg">📚</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Akademia FlowForge</h1>
            <p className="text-sm text-zinc-400">Poradniki i artykuły o rapie, flowie i technice</p>
          </div>
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filterCategory === cat
                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/30"
                  : "bg-zinc-800/50 text-zinc-400 border border-transparent hover:text-zinc-200"
              }`}
            >
              {cat === "all" ? "🔍 Wszystkie" : cat}
            </button>
          ))}
        </div>

        {/* Articles */}
        <div className="space-y-4">
          {filtered.map((article) => (
            <div key={article.id} className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === article.id ? null : article.id)}
                className="w-full p-6 text-left flex items-center gap-4 hover:bg-zinc-800/20 transition-colors"
              >
                <span className="text-2xl">{article.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs text-zinc-500">{article.category}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${DIFFICULTY_COLORS[article.difficulty]}`}>
                      {DIFFICULTY_LABELS[article.difficulty]}
                    </span>
                    <span className="text-xs text-zinc-600">⏱ {article.readTime}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-white">{article.title}</h3>
                </div>
                <span className={`text-zinc-500 transition-transform ${expandedId === article.id ? "rotate-180" : ""}`}>
                  ▼
                </span>
              </button>

              {expandedId === article.id && (
                <div className="px-6 pb-6 animate-slide-down">
                  <div className="p-6 rounded-xl bg-zinc-800/30 border border-zinc-700/20">
                    <div className="prose prose-invert prose-sm max-w-none">
                      {article.content.split("\n\n").map((paragraph, i) => {
                        if (paragraph.startsWith("**") && paragraph.endsWith("**")) {
                          return <h4 key={i} className="text-white font-semibold mt-4 mb-2">{paragraph.replace(/\*\*/g, "")}</h4>;
                        }
                        return (
                          <p key={i} className="text-zinc-300 text-sm leading-relaxed mb-3 whitespace-pre-wrap">
                            {paragraph.split("**").map((part, j) =>
                              j % 2 === 1 ? <strong key={j} className="text-white">{part}</strong> : part
                            )}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
