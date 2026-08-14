"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { useToast } from "@/components/studio/useToast";
import { ToastView } from "@/components/studio/ToastView";
import { fetchDbOrCache, saveCache, tryDbWrite } from "@/lib/db-sync";
import { createExpense, deleteExpense, getExpenses } from "@/actions/budget";

const CACHE_KEY = "flowforge-budget-expenses";

function toExpense(e: Awaited<ReturnType<typeof getExpenses>>[number]): Expense {
  return {
    id: e.id,
    category: e.category,
    title: e.title,
    amount: e.amount,
    currency: e.currency || "PLN",
    description: e.description || "",
    date: new Date(e.date).toISOString().split("T")[0],
    project: e.project || "",
  };
}

interface Expense {
  id: string;
  category: string;
  title: string;
  amount: number;
  currency: string;
  description: string;
  date: string;
  project: string;
}

const CATEGORIES = [
  { id: "beat_license", label: "Licencja na bit", icon: "🎵" },
  { id: "mix_master", label: "Mix/Mastering", icon: "🎛️" },
  { id: "cover_art", label: "Okładka", icon: "🎨" },
  { id: "promo", label: "Promocja", icon: "📢" },
  { id: "studio", label: "Sesja studyjna", icon: "🎙️" },
  { id: "equipment", label: "Sprzęt", icon: "🎧" },
  { id: "other", label: "Inne", icon: "📦" },
];

export default function BudgetPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expensesLoaded, setExpensesLoaded] = useState(false);
  const [newExpense, setNewExpense] = useState({
    category: "beat_license",
    title: "",
    amount: 0,
    description: "",
    project: "",
  });

  const { toast, showToast } = useToast();

  // ── Load expenses from the DB (fallback: localStorage cache) ──
  useEffect(() => {
    let cancelled = false;
    fetchDbOrCache(CACHE_KEY, async () => (await getExpenses()).map(toExpense), [] as Expense[]).then((rows) => {
      if (cancelled) return;
      setExpenses(rows);
      setExpensesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Mirror the list into the cache whenever it changes ──
  useEffect(() => {
    if (!expensesLoaded) return;
    saveCache(CACHE_KEY, expenses);
  }, [expenses, expensesLoaded]);

  const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);
  const categoryTotals = CATEGORIES.map((cat) => ({
    ...cat,
    total: expenses.filter((e) => e.category === cat.id).reduce((sum, e) => sum + e.amount, 0),
  })).filter((c) => c.total > 0);

  const projectTotals = expenses
    .filter((e) => e.project)
    .reduce((acc, e) => {
      acc[e.project] = (acc[e.project] || 0) + e.amount;
      return acc;
    }, {} as Record<string, number>);

  const addExpense = useCallback(async () => {
    if (!newExpense.title || newExpense.amount <= 0) return;
    const tempId = `local-${Date.now()}`;
    const expense: Expense = {
      id: tempId,
      category: newExpense.category,
      title: newExpense.title,
      amount: newExpense.amount,
      currency: "PLN",
      description: newExpense.description,
      date: new Date().toISOString().split("T")[0],
      project: newExpense.project,
    };
    // Optimistic add + mirror into the cache, then persist to the DB.
    setExpenses((prev) => [expense, ...prev]);
    setNewExpense({ category: "beat_license", title: "", amount: 0, description: "", project: "" });
    setShowAddForm(false);
    const ok = await tryDbWrite(async () => {
      const created = await createExpense({
        category: expense.category,
        title: expense.title,
        amount: expense.amount,
        currency: expense.currency,
        description: expense.description || undefined,
        date: new Date(expense.date),
        project: expense.project || undefined,
      });
      // Swap the temporary id for the real DB id (keeps delete wired up).
      setExpenses((prev) => prev.map((e) => (e.id === tempId ? toExpense(created) : e)));
    });
    if (!ok) {
      showToast("⚠️ Baza danych niedostępna — wydatek zapisany lokalnie", "info");
    }
  }, [newExpense, showToast]);

  const removeExpense = useCallback((id: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    if (!id.startsWith("local-")) {
      tryDbWrite(() => deleteExpense(id));
    }
  }, []);

  return (
    <AppShell>
      {/* Toast notification — shared component driven by the useToast hook */}
      <ToastView toast={toast} />
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
              <span className="text-lg">💰</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Budżet Projektu</h1>
              <p className="text-sm text-zinc-400">Zarządzaj kosztami produkcji muzycznej</p>
            </div>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 rounded-xl bg-green-500/10 text-green-400 text-sm font-medium hover:bg-green-500/20 transition-colors"
          >
            + Dodaj Wydatek
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-4">
            <p className="text-xs text-zinc-500 mb-1">📊 Łączne wydatki</p>
            <p className="text-2xl font-bold text-white">{totalSpent.toLocaleString()} <span className="text-sm font-normal text-zinc-400">PLN</span></p>
          </div>
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-4">
            <p className="text-xs text-zinc-500 mb-1">📋 Wydatków</p>
            <p className="text-2xl font-bold text-white">{expenses.length}</p>
          </div>
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-4">
            <p className="text-xs text-zinc-500 mb-1">📁 Projektów</p>
            <p className="text-2xl font-bold text-white">{Object.keys(projectTotals).length}</p>
          </div>
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-4">
            <p className="text-xs text-zinc-500 mb-1">💡 Podpowiedź</p>
            <p className="text-xs text-zinc-400">Średnia na projekt</p>
            <p className="text-sm font-bold text-white">
              {Object.keys(projectTotals).length > 0
                ? `${Math.round(totalSpent / Object.keys(projectTotals).length)} PLN`
                : "— PLN"}
            </p>
          </div>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <div className="rounded-2xl bg-zinc-900/50 border border-green-500/20 p-6 space-y-4 animate-slide-down">
            <h3 className="text-lg font-semibold text-white">Nowy Wydatek</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Kategoria</label>
                <select
                  value={newExpense.category}
                  onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white text-sm"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.icon} {cat.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Tytuł</label>
                <input
                  type="text"
                  value={newExpense.title}
                  onChange={(e) => setNewExpense({ ...newExpense, title: e.target.value })}
                  placeholder="Nazwa wydatku..."
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-green-500/30"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Kwota (PLN)</label>
                <input
                  type="number"
                  value={newExpense.amount || ""}
                  onChange={(e) => setNewExpense({ ...newExpense, amount: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-green-500/30"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Projekt</label>
                <input
                  type="text"
                  value={newExpense.project}
                  onChange={(e) => setNewExpense({ ...newExpense, project: e.target.value })}
                  placeholder="Nazwa projektu..."
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-green-500/30"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-sm font-medium hover:bg-zinc-700 transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={addExpense}
                className="px-4 py-2 rounded-xl bg-green-500 text-zinc-900 text-sm font-medium hover:bg-green-400 transition-colors"
              >
                Dodaj
              </button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {expenses.length === 0 ? (
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-16 text-center">
            <span className="text-5xl block mb-4">💰</span>
            <h3 className="text-xl font-bold text-white mb-2">Brak wydatków</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto mb-6">
              Zacznij śledzić koszty produkcji muzycznej. Dodaj pierwszy wydatek, aby zobaczyć statystyki.
            </p>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-5 py-2.5 rounded-xl bg-green-500/10 text-green-400 text-sm font-semibold hover:bg-green-500/20 transition-colors"
            >
              + Dodaj Pierwszy Wydatek
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Category Breakdown */}
            <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-6">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <span>📊</span> Według Kategorii
              </h3>
              <div className="space-y-3">
                {categoryTotals.map((cat) => {
                  const percentage = totalSpent > 0 ? (cat.total / totalSpent) * 100 : 0;
                  return (
                    <div key={cat.id}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-zinc-300">{cat.icon} {cat.label}</span>
                        <span className="text-zinc-400 font-mono">{cat.total.toLocaleString()} PLN</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Expenses List */}
            <div className="lg:col-span-2 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-6">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <span>📋</span> Lista Wydatków
              </h3>
              <div className="space-y-2">
                {expenses.map((expense) => {
                  const cat = CATEGORIES.find((c) => c.id === expense.category);
                  return (
                    <div key={expense.id} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-800/30 group">
                      <span className="text-lg">{cat?.icon || "📦"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{expense.title}</p>
                        <p className="text-xs text-zinc-500">
                          {expense.date} {expense.project && `• ${expense.project}`}
                        </p>
                      </div>
                      <span className="text-sm font-mono font-semibold text-white">
                        -{expense.amount.toLocaleString()} PLN
                      </span>
                      <button
                        onClick={() => removeExpense(expense.id)}
                        className="w-6 h-6 rounded-lg text-zinc-600 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
